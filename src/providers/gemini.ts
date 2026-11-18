
import type {
  Content,
  GenerateContentResponse,
  GoogleGenAI,
  Part,
} from "@google/genai";
import { GoogleGenAI as GoogleGenAIClient } from "@google/genai";

import type {
  Message,
  ModelProvider,
  ToolCall,
  GenerateResponse,
  GenerateRequest,
} from "./types.js";
import { toGeminiFunctionDeclarations } from "./schema.js";
import { withRetry } from "./retry.js";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export interface GeminiProviderOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  client?: Pick<GoogleGenAI, "models">;
}

export function getGeminiConfiguration(env: NodeJS.ProcessEnv = process.env): { apiKey: string; model: string } {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set. Add it to your environment or .env file.");
  return { apiKey, model: env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL };
}

export class GeminiProvider implements ModelProvider {
  readonly model: string;
  private readonly client: Pick<GoogleGenAI, "models">;
  private readonly timeoutMs: number;

  constructor(options: GeminiProviderOptions = {}) {
    const config = options.apiKey === undefined
      ? getGeminiConfiguration()
      : { apiKey: options.apiKey, model: options.model?.trim() || DEFAULT_GEMINI_MODEL };
    if (!config.apiKey.trim()) throw new Error("GEMINI_API_KEY is not set. Add it to your environment or .env file.");
    this.model = options.model?.trim() || config.model;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.client = options.client ?? new GoogleGenAIClient({
      apiKey: config.apiKey,
      vertexai: false,
      httpOptions: { timeout: this.timeoutMs, retryOptions: { attempts: 1 } },
    });
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, deadline]) : deadline;
    const functionDeclarations = request.tools.length > 0
      ? toGeminiFunctionDeclarations(request.tools)
      : undefined;

    const response = await withRetry(
      () => this.client.models.generateContent({
        model: this.model,
        contents: toGeminiContents(request.messages),
        config: {
          systemInstruction: request.system,
          maxOutputTokens: request.maxOutputTokens,
          ...(supportsTemperature(this.model) ? { temperature: request.temperature } : {}),
          abortSignal: signal,
          httpOptions: { timeout: this.timeoutMs, retryOptions: { attempts: 1 } },
          tools: functionDeclarations ? [{ functionDeclarations }] : undefined,
        },
      }),
      { signal },
    );
    return fromGeminiResponse(response);
  }
}

function supportsTemperature(model: string): boolean {
  const majorVersion = /^gemini-(\d+)/i.exec(model)?.[1];
  return majorVersion === undefined || Number(majorVersion) < 3;
}

/**
 * Converts Clyro's conversation history into Gemini Content[].
 */
export function toGeminiContents(messages: Message[]): Content[] {
  const contents: Content[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      contents.push({
        role: "user",
        parts: [{ text: message.text }],
      });

      continue;
    }

    if (message.role === "assistant") {
      // Preserve original Gemini content, including thought signatures.
      if (isGeminiContent(message.raw)) {
        contents.push(message.raw);
        continue;
      }

      const parts: Part[] = [];

      if (message.text) {
        parts.push({ text: message.text });
      }

      for (const call of message.toolCalls) {
        parts.push({
          functionCall: {
            id: call.id,
            name: call.name,
            args: asRecord(call.args),
          },
        });
      }

      contents.push({
        role: "model",
        parts,
      });

      continue;
    }

    if (message.role === "tool") {
      contents.push({
        role: "user",
        parts: message.results.map((item) => ({
          functionResponse: {
            id: item.callId,
            name: item.name,
            response: {
              output: item.result,
            },
          },
        })),
      });
    }
  }

  return contents;
}

function isGeminiContent(value: unknown): value is Content {
  if (!value || typeof value !== "object") {
    return false;
  }

  const content = value as Content;

  return (
    content.role === "model" &&
    Array.isArray(content.parts)
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}


export function fromGeminiResponse(
  response: GenerateContentResponse,
): GenerateResponse {
  const candidate = response.candidates?.[0];
  const content = candidate?.content;
  const parts = content?.parts ?? [];

  const toolCalls: ToolCall[] = parts
    .filter((part) => part.functionCall?.name)
    .map((part, index) => ({
      id: part.functionCall?.id ?? `gemini-call-${index}`,
      name: part.functionCall!.name!,
      args: part.functionCall!.args ?? {},
    }));

  const text = parts
    .filter((part) => typeof part.text === "string" && !part.thought)
    .map((part) => part.text)
    .join("");

    const promptBlockReason = response.promptFeedback?.blockReason;

    const finishReason = promptBlockReason
      ? "safety"
      : mapFinishReason(
          candidate?.finishReason,
          toolCalls.length > 0,
        );

  return {
    text: text || undefined,
    toolCalls,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    },
    finishReason,
    raw: content,
  };
}

function mapFinishReason(
  reason: string | undefined,
  hasToolCalls: boolean,
): GenerateResponse["finishReason"] {
  if (hasToolCalls) {
    return "tool_calls";
  }

  switch (reason) {
    case "STOP":
      return "stop";

    case "MAX_TOKENS":
      return "length";

    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
      return "safety";

    default:
      return "error";
  }
}
