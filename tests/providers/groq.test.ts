import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GroqProvider, fromGroqResponse, getGroqConfiguration, toGroqMessages } from "../../src/providers/groq.js";
import type { GroqProviderOptions } from "../../src/providers/groq.js";
import type { GenerateRequest } from "../../src/providers/types.js";

function groqResponse(value: object): Parameters<typeof fromGroqResponse>[0] {
  return value as Parameters<typeof fromGroqResponse>[0];
}

function mockProvider(generate: ReturnType<typeof vi.fn>, options: Omit<GroqProviderOptions, "client"> = {}) {
  const client = { chat: { completions: { create: generate } } } as unknown as NonNullable<GroqProviderOptions["client"]>;
  return new GroqProvider({ apiKey: "unit-test-key", client, ...options });
}

const request: GenerateRequest = {
  system: "Be concise",
  messages: [{ role: "user", text: "Ping" }],
  tools: [],
};

describe("Groq chat mapping", () => {
  it("maps assistant text, usage and stop reason", () => {
    const response = fromGroqResponse(groqResponse({
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Hello" } }],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    }));
    expect(response).toMatchObject({
      text: "Hello", toolCalls: [], finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 4 },
      raw: { provider: "groq", message: { role: "assistant", content: "Hello" } },
    });
  });

  it("maps one and multiple function tool calls", () => {
    const response = fromGroqResponse(groqResponse({
      choices: [{
        finish_reason: "tool_calls",
        message: {
          role: "assistant", content: null,
          tool_calls: [
            { id: "call-a", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } },
            { id: "call-b", type: "function", function: { name: "list_files", arguments: '{"path":"src"}' } },
          ],
        },
      }],
    }));
    expect(response.toolCalls).toEqual([
      { id: "call-a", name: "read_file", args: { path: "a.ts" } },
      { id: "call-b", name: "list_files", args: { path: "src" } },
    ]);
    expect(response.finishReason).toBe("tool_calls");
  });

  it("keeps malformed function arguments as a non-object so tool schemas reject them", () => {
    const response = fromGroqResponse(groqResponse({
      choices: [{
        finish_reason: "tool_calls",
        message: { role: "assistant", content: null, tool_calls: [
          { id: "bad", type: "function", function: { name: "read_file", arguments: "{broken" } },
        ] },
      }],
    }));
    expect(response.toolCalls[0].args).toBe("{broken");
    expect(z.object({ path: z.string() }).safeParse(response.toolCalls[0].args).success).toBe(false);
  });

  it("maps length and content-filter finish reasons", () => {
    expect(fromGroqResponse(groqResponse({ choices: [{ finish_reason: "length", message: { role: "assistant", content: "partial" } }] })).finishReason).toBe("length");
    expect(fromGroqResponse(groqResponse({ choices: [{ finish_reason: "content_filter", message: { role: "assistant", content: null } }] })).finishReason).toBe("safety");
  });

  it("converts Clyro tool results into ID-associated Groq tool messages", () => {
    expect(toGroqMessages("system", [
      { role: "assistant", text: "Reading", toolCalls: [{ id: "call-1", name: "read_file", args: { path: "a.ts" } }] },
      { role: "tool", results: [{ callId: "call-1", name: "read_file", result: { content: "source" } }] },
    ])).toEqual([
      { role: "system", content: "system" },
      {
        role: "assistant", content: "Reading",
        tool_calls: [{ id: "call-1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }],
      },
      { role: "tool", tool_call_id: "call-1", content: '{"content":"source"}' },
    ]);
  });

  it("replays Groq raw messages only in Groq form", () => {
    const raw = { provider: "groq", message: { role: "assistant", content: null, tool_calls: [] } };
    expect(toGroqMessages("s", [{ role: "assistant", text: "neutral", toolCalls: [], raw }])[1]).toBe(raw.message);
    expect(toGroqMessages("s", [{ role: "assistant", text: "neutral", toolCalls: [], raw: { role: "model", parts: [{ text: "gemini" }] } }])[1])
      .toEqual({ role: "assistant", content: "neutral" });
  });
});

describe("GroqProvider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("validates configuration and defaults to GPT-OSS 120B", () => {
    expect(() => getGroqConfiguration({})).toThrow(/GROQ_API_KEY is not set/);
    expect(getGroqConfiguration({ GROQ_API_KEY: "key" })).toEqual({ apiKey: "key", model: "openai/gpt-oss-120b" });
  });

  it("builds an official chat-completion request with function tools and cancellation", async () => {
    const controller = new AbortController();
    const create = vi.fn().mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "OK" } }],
    });
    const provider = mockProvider(create, { model: "openai/gpt-oss-120b", timeoutMs: 500 });
    const result = await provider.generate({
      ...request,
      signal: controller.signal,
      maxOutputTokens: 12,
      temperature: 0,
      tools: [{ name: "read_file", description: "Read a file", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }],
    });

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0]).toMatchObject({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "system", content: "Be concise" }, { role: "user", content: "Ping" }],
      max_completion_tokens: 12,
      temperature: 0,
      tools: [{ type: "function", function: { name: "read_file", description: "Read a file", parameters: { type: "object" } } }],
      tool_choice: "auto",
    });
    expect(create.mock.calls[0][1]).toMatchObject({ signal: expect.any(AbortSignal), timeout: 1500, maxRetries: 0 });
    expect(result.text).toBe("OK");
  });

  it("propagates cancellation during an in-flight request", async () => {
    const controller = new AbortController();
    const create = vi.fn().mockImplementation((_body, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      setTimeout(() => controller.abort(new Error("cancelled")), 0);
    }));
    const provider = mockProvider(create, { timeoutMs: 1000 });
    await expect(provider.generate({ ...request, signal: controller.signal })).rejects.toThrow("cancelled");
    expect(create).toHaveBeenCalledOnce();
  });

  it("enforces a request deadline", async () => {
    const create = vi.fn().mockImplementation((_body, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")), { once: true });
    }));
    const provider = mockProvider(create, { timeoutMs: 15 });
    await expect(provider.generate(request)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(create).toHaveBeenCalledOnce();
  });
});
