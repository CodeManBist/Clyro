
export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
}

function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const status = (error as { status?: number }).status;

  return status === 429 || (status !== undefined && status >= 500 && status <= 599);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Operation aborted"));
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason ?? new Error("Operation aborted"));
    };

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
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

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error("Operation aborted");
    }

    try {
      return await operation();
    } catch (error) {
      if (
        attempt === maxAttempts ||
        !isRetryableError(error) ||
        isAbortError(error) ||
        signal?.aborted
      ) {
        throw error;
      }

      const exponentialDelay = Math.min(
        maxDelayMs,
        baseDelayMs * 2 ** (attempt - 1),
      );

      // Full jitter: random delay between zero and the exponential cap.
      const delay = Math.random() * exponentialDelay;

      await sleep(delay, signal);
    }
  }

  throw new Error("Retry attempts exhausted");
}
