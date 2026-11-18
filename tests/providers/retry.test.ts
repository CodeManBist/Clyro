
import { describe, it, expect, vi, afterEach } from "vitest";
import { ApiError } from "@google/genai";
import { withRetry } from "../../src/providers/retry.js";

function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe("withRetry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns the result when the operation succeeds", async () => {
    const operation = vi.fn().mockResolvedValue("success");

    await expect(withRetry(operation)).resolves.toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries an SDK-shaped 429 ApiError and succeeds", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new ApiError({ status: 429, message: '{"error":{"code":429}}' }))
      .mockResolvedValue("success");

    vi.spyOn(Math, "random").mockReturnValue(0);

    await expect(
      withRetry(operation, { baseDelayMs: 1 }),
    ).resolves.toBe("success");

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("retries an SDK-shaped 503 ApiError and succeeds", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new ApiError({ status: 503, message: '{"error":{"code":503}}' }))
      .mockResolvedValue("success");

    vi.spyOn(Math, "random").mockReturnValue(0);

    await expect(
      withRetry(operation, { baseDelayMs: 1 }),
    ).resolves.toBe("success");

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400 error", async () => {
    const sdkError = new ApiError({ status: 400, message: '{"error":{"code":400}}' });
    const operation = vi.fn().mockRejectedValue(sdkError);

    await expect(withRetry(operation)).rejects.toBe(sdkError);

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("stops after the configured maximum attempts", async () => {
    const operation = vi.fn().mockRejectedValue(new ApiError({ status: 503, message: "unavailable" }));

    vi.spyOn(Math, "random").mockReturnValue(0);

    await expect(
      withRetry(operation, {
        maxAttempts: 3,
        baseDelayMs: 1,
      }),
    ).rejects.toMatchObject({ status: 503, name: "ApiError" });

    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("does not retry after cancellation", async () => {
    const controller = new AbortController();
    const operation = vi.fn().mockRejectedValue(httpError(503));

    controller.abort();

    await expect(
      withRetry(operation, { signal: controller.signal }),
    ).rejects.toThrow();

    expect(operation).not.toHaveBeenCalled();
  });

  it("aborts during the retry delay", async () => {
    const controller = new AbortController();
    const operation = vi.fn().mockRejectedValue(httpError(429));
    vi.spyOn(Math, "random").mockReturnValue(1);
    const retry = withRetry(operation, { baseDelayMs: 30_000, signal: controller.signal });
    setTimeout(() => controller.abort(new Error("cancelled")), 5);
    await expect(retry).rejects.toThrow("cancelled");
    expect(operation).toHaveBeenCalledOnce();
  });

  it("recognizes a retryable status nested in a transport wrapper", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce({ cause: { response: { status: 503 } } })
      .mockResolvedValue("recovered");
    vi.spyOn(Math, "random").mockReturnValue(0);
    await expect(withRetry(operation, { baseDelayMs: 1 })).resolves.toBe("recovered");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("honors exposed Retry-After headers within the configured delay bound", async () => {
    vi.useFakeTimers();
    const operation = vi.fn()
      .mockRejectedValueOnce(Object.assign(new ApiError({ status: 429, message: "busy" }), {
        response: { headers: new Headers({ "retry-after": "2" }) },
      }))
      .mockResolvedValue("recovered");
    const retry = withRetry(operation, { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 5_000 });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(operation).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(retry).resolves.toBe("recovered");
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
