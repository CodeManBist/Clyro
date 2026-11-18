
import { describe, it, expect, vi } from "vitest";
import { GeminiProvider, getGeminiConfiguration, toGeminiContents, fromGeminiResponse } from "../../src/providers/gemini.js";
import type { GenerateContentResponse, GoogleGenAI } from "@google/genai";
import type { Message } from "../../src/providers/types.js";

describe("Gemini message mapping", () => {
  it("converts user messages into Gemini content", () => {
    const messages: Message[] = [
      { role: "user", text: "Find the bug" },
    ];

    expect(toGeminiContents(messages)).toEqual([
      {
        role: "user",
        parts: [{ text: "Find the bug" }],
      },
    ]);
  });

  it("converts multiple assistant tool calls", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        toolCalls: [
          {
            id: "call-1",
            name: "read_file",
            args: { path: "src/index.ts" },
          },
          {
            id: "call-2",
            name: "list_files",
            args: { path: "src" },
          },
        ],
      },
    ];

    const result = toGeminiContents(messages);

    expect(result[0].role).toBe("model");
    expect(result[0].parts).toHaveLength(2);
    expect(result[0].parts?.[0].functionCall?.name).toBe("read_file");
    expect(result[0].parts?.[1].functionCall?.name).toBe("list_files");
  });

  it("converts tool results into Gemini function responses", () => {
    const messages: Message[] = [
      {
        role: "tool",
        results: [
          {
            callId: "call-1",
            name: "read_file",
            result: { content: "Hello Clyro" },
          },
        ],
      },
    ];

    const result = toGeminiContents(messages);

    expect(result[0].role).toBe("user");
    expect(result[0].parts?.[0].functionResponse).toEqual({
      id: "call-1",
      name: "read_file",
      response: {
        output: { content: "Hello Clyro" },
      },
    });
  });

  it("preserves original Gemini content and thought signatures", () => {
    const rawContent = {
      role: "model",
      parts: [
        {
          functionCall: {
            id: "call-1",
            name: "read_file",
            args: { path: "src/index.ts" },
          },
          thoughtSignature: "signature-123",
        },
      ],
    };

    const messages: Message[] = [
      {
        role: "assistant",
        toolCalls: [],
        raw: rawContent,
      },
    ];

    expect(toGeminiContents(messages)[0]).toBe(rawContent);
  });

  it("maps Gemini responses and token usage", () => {
    const response = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: "Found the issue." }],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 25,
      },
    } as GenerateContentResponse;

    expect(fromGeminiResponse(response)).toMatchObject({
      text: "Found the issue.",
      toolCalls: [],
      usage: {
        inputTokens: 100,
        outputTokens: 25,
      },
      finishReason: "stop",
    });
  });

  it("extracts multiple function calls from a Gemini response", () => {
    const response = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  id: "call-1",
                  name: "read_file",
                  args: { path: "src/index.ts" },
                },
              },
              {
                functionCall: {
                  id: "call-2",
                  name: "list_files",
                  args: { path: "src" },
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    } as GenerateContentResponse;

    const result = fromGeminiResponse(response);

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls.map((call) => call.name)).toEqual([
      "read_file",
      "list_files",
    ]);
    expect(result.finishReason).toBe("tool_calls");
  });

  it("handles safety-blocked responses without candidates", () => {
    const response = {
      candidates: [],
      promptFeedback: {
        blockReason: "SAFETY",
      },
    } as GenerateContentResponse;
  
    const result = fromGeminiResponse(response);
  
    expect(result.text).toBeUndefined();
    expect(result.toolCalls).toEqual([]);
    expect(result.finishReason).toBe("safety");
  });
});

describe("GeminiProvider", () => {
  it("fails clearly when the API key is missing", () => {
    expect(() => getGeminiConfiguration({})).toThrow(/GEMINI_API_KEY is not set/);
  });

  it("constructs a Gemini Developer API request and maps its response", async () => {
    const rawContent = { role: "model", parts: [{ text: "OK" }] };
    const response = {
      candidates: [{ content: rawContent, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 },
    } as GenerateContentResponse;
    const generateContent = vi.fn().mockResolvedValue(response);
    const client = { models: { generateContent } } as unknown as Pick<GoogleGenAI, "models">;
    const provider = new GeminiProvider({ apiKey: "test-key", model: "test-model", client });
    const result = await provider.generate({
      system: "Be concise", messages: [{ role: "user", text: "Ping" }],
      tools: [{ name: "read_file", description: "Read a file", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }],
      maxOutputTokens: 12, temperature: 0,
    });

    expect(generateContent).toHaveBeenCalledOnce();
    expect(generateContent.mock.calls[0][0]).toMatchObject({
      model: "test-model",
      contents: [{ role: "user", parts: [{ text: "Ping" }] }],
      config: {
        systemInstruction: "Be concise", maxOutputTokens: 12, temperature: 0,
        tools: [{ functionDeclarations: [{ name: "read_file", parametersJsonSchema: { type: "object" } }] }],
      },
    });
    expect(result.raw).toBe(rawContent);
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 1 });
  });

  it("passes cancellation to the SDK", async () => {
    const controller = new AbortController();
    const generateContent = vi.fn().mockImplementation(({ config }) => {
      expect(config.abortSignal).toBeInstanceOf(AbortSignal);
      return new Promise((_resolve, reject) => {
        config.abortSignal.addEventListener("abort", () => reject(config.abortSignal.reason), { once: true });
        setTimeout(() => controller.abort(new Error("caller cancelled")), 0);
      });
    });
    const client = { models: { generateContent } } as unknown as Pick<GoogleGenAI, "models">;
    const provider = new GeminiProvider({ apiKey: "test", client, timeoutMs: 1000 });
    await expect(provider.generate({ system: "", messages: [], tools: [], signal: controller.signal }))
      .rejects.toThrow("caller cancelled");
    expect(generateContent).toHaveBeenCalledOnce();
  });

  it("aborts an in-flight request when its deadline expires", async () => {
    const generateContent = vi.fn().mockImplementation(({ config }) => new Promise((_resolve, reject) => {
      config.abortSignal.addEventListener("abort", () => reject(config.abortSignal.reason), { once: true });
    }));
    const client = { models: { generateContent } } as unknown as Pick<GoogleGenAI, "models">;
    const provider = new GeminiProvider({ apiKey: "test", client, timeoutMs: 15 });

    await expect(provider.generate({ system: "", messages: [], tools: [] }))
      .rejects.toMatchObject({ name: "TimeoutError" });
    expect(generateContent).toHaveBeenCalledOnce();
  });

  it("rejects invalid request deadlines", () => {
    expect(() => new GeminiProvider({ apiKey: "test", timeoutMs: 0, client: { models: { generateContent: vi.fn() } } as unknown as Pick<GoogleGenAI, "models"> }))
      .toThrow(/timeoutMs must be an integer/);
  });

  it("omits temperature for Gemini 3 models", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      candidates: [{ content: { role: "model", parts: [{ text: "OK" }] }, finishReason: "STOP" }],
    });
    const client = { models: { generateContent } } as unknown as Pick<GoogleGenAI, "models">;
    const provider = new GeminiProvider({ apiKey: "test", model: "gemini-3.8-flash", client });
    await provider.generate({ system: "", messages: [], tools: [], temperature: 0 });
    expect(generateContent.mock.calls[0][0].config).not.toHaveProperty("temperature");
  });
});
