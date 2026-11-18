import { afterEach, describe, expect, it, vi } from "vitest";
import { FallbackProvider, ProviderFailoverError, createProviderRouter, describeProviderFailure, resolveProviderPlan } from "../../src/providers/fallback.js";
import { withRetry } from "../../src/providers/retry.js";
import type { GenerateRequest, GenerateResponse, ModelProvider } from "../../src/providers/types.js";

const response: GenerateResponse = {
  text: "answer", toolCalls: [], usage: { inputTokens: 2, outputTokens: 1 }, finishReason: "stop",
};
const request: GenerateRequest = { system: "system", messages: [{ role: "user", text: "question" }], tools: [] };

function providerEntry(name: "gemini" | "groq", provider: ModelProvider, model = `${name}-model`) {
  return { name, model, apiKey: `${name}-test-key`, provider };
}

function router(primary: "gemini" | "groq", primaryProvider: ModelProvider, fallback?: "gemini" | "groq", fallbackProvider?: ModelProvider) {
  return new FallbackProvider(
    providerEntry(primary, primaryProvider),
    fallback && fallbackProvider ? providerEntry(fallback, fallbackProvider) : undefined,
  );
}

function statusError(status: number): Error & { status: number } {
  return Object.assign(new Error(`failure body that should not surface ${status}`), { status });
}

describe("provider selection", () => {
  afterEach(() => vi.restoreAllMocks());

  it("selects Gemini primary and Groq fallback", () => {
    const plan = resolveProviderPlan({
      AI_PROVIDER: "gemini", AI_FALLBACK_PROVIDER: "groq",
      GEMINI_API_KEY: "g-key", GROQ_API_KEY: "q-key",
      GEMINI_MODEL: "gemini-model", GROQ_MODEL: "groq-model",
    });
    expect(plan).toEqual({
      primary: { name: "gemini", apiKey: "g-key", model: "gemini-model" },
      fallback: { name: "groq", apiKey: "q-key", model: "groq-model" },
    });
  });

  it("selects Groq primary and Gemini fallback using their configured models", () => {
    const plan = resolveProviderPlan({ AI_PROVIDER: "groq", AI_FALLBACK_PROVIDER: "gemini", GROQ_API_KEY: "q-key", GEMINI_API_KEY: "g-key" });
    expect(plan.primary).toMatchObject({ name: "groq", model: "openai/gpt-oss-120b" });
    expect(plan.fallback).toMatchObject({ name: "gemini" });
  });

  it("supports a single provider without constructing a fallback", () => {
    const groq = { generate: vi.fn().mockResolvedValue(response) };
    const geminiFactory = vi.fn(() => ({ generate: vi.fn() }));
    const selected = createProviderRouter({ AI_PROVIDER: "groq", GROQ_API_KEY: "q-key" }, {
      groq: () => groq,
      gemini: geminiFactory,
    });
    expect(selected.primary.name).toBe("groq");
    expect(selected.fallback).toBeUndefined();
    expect(geminiFactory).not.toHaveBeenCalled();
  });

  it("defaults to Gemini and validates required keys and provider names", () => {
    expect(() => resolveProviderPlan({})).toThrow(/GEMINI_API_KEY is required/);
    expect(() => resolveProviderPlan({ AI_PROVIDER: "groq" })).toThrow(/GROQ_API_KEY is required/);
    expect(() => resolveProviderPlan({ AI_PROVIDER: "gemini", AI_FALLBACK_PROVIDER: "groq", GEMINI_API_KEY: "key" }))
      .toThrow(/GROQ_API_KEY is required/);
    expect(() => resolveProviderPlan({ AI_PROVIDER: "other", GEMINI_API_KEY: "key" })).toThrow(/AI_PROVIDER must be either/);
    expect(() => resolveProviderPlan({ AI_PROVIDER: "gemini", AI_FALLBACK_PROVIDER: "gemini", GEMINI_API_KEY: "key" })).toThrow(/must be different/);
  });
});

describe("FallbackProvider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not call fallback when primary succeeds", async () => {
    const primary = { generate: vi.fn().mockResolvedValue(response) };
    const fallback = { generate: vi.fn() };
    const result = await router("gemini", primary, "groq", fallback).generateWithMetadata(request);
    expect(result.response).toBe(response);
    expect(result.metadata).toMatchObject({ primaryProvider: "gemini", respondingProvider: "gemini", fallbackAttempted: false });
    expect(fallback.generate).not.toHaveBeenCalled();
  });

  it.each([429, 503])("uses fallback after primary exhausts retries for HTTP %i", async (status) => {
    let attempts = 0;
    const primary = {
      generate: vi.fn(() => withRetry(async () => {
        attempts++;
        throw statusError(status);
      }, { maxAttempts: 4, baseDelayMs: 0 })),
    };
    const fallback = { generate: vi.fn().mockResolvedValue(response) };
    vi.spyOn(Math, "random").mockReturnValue(0);
    const result = await router("gemini", primary, "groq", fallback).generateWithMetadata(request);
    expect(attempts).toBe(4);
    expect(primary.generate).toHaveBeenCalledOnce();
    expect(fallback.generate).toHaveBeenCalledOnce();
    expect(result.metadata).toMatchObject({ fallbackAttempted: true, respondingProvider: "groq" });
  });

  it.each([400, 401])("does not fail over for permanent HTTP %i errors", async (status) => {
    const primary = { generate: vi.fn().mockRejectedValue(statusError(status)) };
    const fallback = { generate: vi.fn() };
    await expect(router("gemini", primary, "groq", fallback).generate(request)).rejects.toMatchObject({ status });
    expect(fallback.generate).not.toHaveBeenCalled();
  });

  it("does not fail over for a safety response", async () => {
    const safety = { ...response, finishReason: "safety" as const };
    const primary = { generate: vi.fn().mockResolvedValue(safety) };
    const fallback = { generate: vi.fn() };
    await expect(router("gemini", primary, "groq", fallback).generate(request)).resolves.toBe(safety);
    expect(fallback.generate).not.toHaveBeenCalled();
  });

  it("fails over after a provider request deadline without misreporting it as HTTP", async () => {
    const primary = { generate: vi.fn().mockRejectedValue(new DOMException("deadline", "TimeoutError")) };
    const fallback = { generate: vi.fn().mockResolvedValue(response) };
    const selected = router("gemini", primary, "groq", fallback);
    const result = await selected.generateWithMetadata(request);
    expect(result.metadata).toMatchObject({ fallbackAttempted: true, respondingProvider: "groq" });
    expect(describeProviderFailure(new DOMException("deadline", "TimeoutError"))).toBe("TimeoutError");
  });

  it("does not start either provider after cancellation", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    controller.abort(reason);
    const primary = { generate: vi.fn() };
    const fallback = { generate: vi.fn() };
    await expect(router("gemini", primary, "groq", fallback).generate({ ...request, signal: controller.signal }))
      .rejects.toBe(reason);
    expect(primary.generate).not.toHaveBeenCalled();
    expect(fallback.generate).not.toHaveBeenCalled();
  });

  it("does not fail over when cancellation occurs during the primary call", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled in flight");
    const primary = { generate: vi.fn().mockImplementation(async () => {
      controller.abort(reason);
      throw statusError(503);
    }) };
    const fallback = { generate: vi.fn() };
    await expect(router("gemini", primary, "groq", fallback).generate({ ...request, signal: controller.signal }))
      .rejects.toBe(reason);
    expect(fallback.generate).not.toHaveBeenCalled();
  });

  it("returns the original primary failure when no fallback is configured", async () => {
    const failure = statusError(503);
    const primary = { generate: vi.fn().mockRejectedValue(failure) };
    await expect(router("gemini", primary).generate(request)).rejects.toBe(failure);
  });

  it("combines failure categories without including error bodies", async () => {
    const primary = { generate: vi.fn().mockRejectedValue(statusError(503)) };
    const fallback = { generate: vi.fn().mockRejectedValue(statusError(502)) };
    const selected = router("gemini", primary, "groq", fallback);
    let observed: unknown;
    try {
      await selected.generate(request);
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(ProviderFailoverError);
    expect((observed as Error).message).toBe("Primary provider gemini failed (HTTP 503 Error); fallback provider groq failed (HTTP 502 Error).");
    expect((observed as Error).message).not.toMatch(/failure body|test-key/);
    expect(fallback.generate).toHaveBeenCalledOnce();
  });

  it("attempts fallback once and returns its tool calls without executing them", async () => {
    const primary = { generate: vi.fn().mockRejectedValue(statusError(503)) };
    const toolResponse = { ...response, text: undefined, finishReason: "tool_calls" as const, toolCalls: [{ id: "c1", name: "read_file", args: { path: "a.ts" } }] };
    const fallback = { generate: vi.fn().mockResolvedValue(toolResponse) };
    const result = await router("groq", primary, "gemini", fallback).generateWithMetadata(request);
    expect(result.response.toolCalls).toEqual(toolResponse.toolCalls);
    expect(fallback.generate).toHaveBeenCalledOnce();
  });

  it("preserves only history raw content belonging to each target provider", async () => {
    const geminiRaw = { role: "model", parts: [{ text: "Gemini raw" }] };
    const groqRaw = { provider: "groq", message: { role: "assistant", content: "Groq raw" } };
    const primary = { generate: vi.fn().mockRejectedValue(statusError(503)) };
    const fallback = { generate: vi.fn().mockResolvedValue(response) };
    const selected = router("gemini", primary, "groq", fallback);

    await selected.generate({ ...request, messages: [{ role: "assistant", text: "neutral", toolCalls: [], raw: geminiRaw }] });
    expect(primary.generate.mock.calls[0][0].messages[0].raw).toBe(geminiRaw);
    expect(fallback.generate.mock.calls[0][0].messages[0]).toEqual({ role: "assistant", text: "neutral", toolCalls: [] });

    primary.generate.mockRejectedValueOnce(statusError(503));
    await selected.generate({ ...request, messages: [{ role: "assistant", text: "neutral", toolCalls: [], raw: groqRaw }] });
    expect(primary.generate.mock.calls[1][0].messages[0]).toEqual({ role: "assistant", text: "neutral", toolCalls: [] });
    expect(fallback.generate.mock.calls[1][0].messages[0].raw).toBe(groqRaw);
  });
});
