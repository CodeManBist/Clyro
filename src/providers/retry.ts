export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
}

export function getProviderErrorStatus(error: unknown, seen = new Set<object>()): number | undefined {
  if (!error || typeof error !== "object" || seen.has(error)) return undefined;
  seen.add(error);

  const value = error as Record<string, unknown>;
  const status = toHttpStatus(value.status);
  if (status !== undefined) return status;

  // Some wrappers put the HTTP code inside their structured API error body.
  if (value.error && typeof value.error === "object") {
    const payload = value.error as Record<string, unknown>;
    const payloadStatus = toHttpStatus(payload.status) ?? toHttpStatus(payload.code);
    if (payloadStatus !== undefined) return payloadStatus;
  }

  for (const nested of [value.response, value.error, value.cause]) {
    const status = getProviderErrorStatus(nested, seen);
    if (status !== undefined) return status;
  }
  return undefined;
}

function errorClassName(error: object): string | undefined {
  const constructorName = (error as { constructor?: { name?: unknown } }).constructor?.name;
  return typeof constructorName === "string" ? constructorName : undefined;
}

const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH",
  "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET",
]);

function hasTransientNetworkFailure(error: unknown, seen = new Set<object>()): boolean {
  if (!error || typeof error !== "object" || seen.has(error)) return false;
  seen.add(error);
  const record = error as Record<string, unknown>;
  const type = errorClassName(error);
  if (type === "APIConnectionError" || type === "APIConnectionTimeoutError") return true;
  if (typeof record.code === "string" && TRANSIENT_NETWORK_CODES.has(record.code)) return true;
  return hasTransientNetworkFailure(record.cause, seen);
}

export function isRetryableProviderError(error: unknown): boolean {
  if (!error || typeof error !== "object" || isAbortError(error)) return false;
  const status = getProviderErrorStatus(error);
  return status === 408 || status === 429 || (status !== undefined && status >= 500 && status <= 599)
    || isProviderTimeout(error)
    || hasTransientNetworkFailure(error);
}

function toHttpStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

function isProviderTimeout(error: object): boolean {
  const namedError = error as { name?: unknown };
  return namedError.name === "TimeoutError" || errorClassName(error) === "APIConnectionTimeoutError";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const headerBag = headers as { get?: (key: string) => string | null } & Record<string, unknown>;
  if (typeof headerBag.get === "function") return headerBag.get(name) ?? undefined;
  const key = Object.keys(headerBag).find((item) => item.toLowerCase() === name.toLowerCase());
  return key && typeof headerBag[key] === "string" ? headerBag[key] as string : undefined;
}

function parseRetryAfter(value: string | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/**
 * SDK v3.3.0's ApiError does not expose response headers. This supports
 * transports/wrappers that retain Retry-After or Retry-After-Ms metadata.
 */
function retryAfterMsFrom(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as Record<string, unknown>;
  if (typeof value.retryAfterMs === "number" && Number.isFinite(value.retryAfterMs) && value.retryAfterMs >= 0) {
    return value.retryAfterMs;
  }
  const directRetryAfter = parseRetryAfter(typeof value.retryAfter === "string" ? value.retryAfter : undefined);
  if (directRetryAfter !== undefined) return directRetryAfter;

  const response = value.response && typeof value.response === "object"
    ? value.response as Record<string, unknown>
    : undefined;
  const headers = value.headers ?? response?.headers;
  const milliseconds = readHeader(headers, "retry-after-ms");
  if (milliseconds !== undefined) {
    const parsed = Number(milliseconds);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return parseRetryAfter(readHeader(headers, "retry-after"));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Operation aborted"));
      return;
    }

    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason ?? new Error("Operation aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 4,
    baseDelayMs = 1_000,
    maxDelayMs = 30_000,
    signal,
  } = options;

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0 || !Number.isFinite(maxDelayMs) || maxDelayMs < 0) {
    throw new RangeError("Retry delays must be finite non-negative numbers");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw signal.reason ?? new Error("Operation aborted");

    try {
      return await operation();
    } catch (error) {
      if (attempt === maxAttempts || !isRetryableProviderError(error) || signal?.aborted) {
        throw error;
      }

      const exponentialCap = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const serverDelay = retryAfterMsFrom(error);
      const delay = serverDelay === undefined
        ? Math.random() * exponentialCap
        : Math.min(maxDelayMs, serverDelay);
      await sleep(delay, signal);
    }
  }

  throw new Error("Retry attempts exhausted");
}
