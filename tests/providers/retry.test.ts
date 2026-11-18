
import { describe, it, expect, vi, afterEach } from "vitest";
import { withRetry } from "../../src/providers/retry.js";

function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe("withRetry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the result when the operation succeeds", async () => {
    const operation = vi.fn().mockResolvedValue("success");

    await expect(withRetry(operation)).resolves.toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 error and succeeds", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValue("success");

    vi.spyOn(Math, "random").mockReturnValue(0);

    await expect(
      withRetry(operation, { baseDelayMs: 1 }),
    ).resolves.toBe("success");

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("retries a 503 error", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValue("success");

    vi.spyOn(Math, "random").mockReturnValue(0);

    await expect(
      withRetry(operation, { baseDelayMs: 1 }),
    ).resolves.toBe("success");

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400 error", async () => {
    const operation = vi.fn().mockRejectedValue(httpError(400));

    await expect(withRetry(operation)).rejects.toMatchObject({
      status: 400,
    });

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("stops after the configured maximum attempts", async () => {
    const operation = vi.fn().mockRejectedValue(httpError(503));

    vi.spyOn(Math, "random").mockReturnValue(0);

    await expect(
      withRetry(operation, {
        maxAttempts: 3,
        baseDelayMs: 1,
      }),
    ).rejects.toMatchObject({ status: 503 });

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
});
