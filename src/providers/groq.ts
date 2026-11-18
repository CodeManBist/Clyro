import Groq from "groq-sdk";
import type {
  Chat,
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionAssistantMessageParam,
} from "groq-sdk/resources/chat";
import type { GenerateRequest, GenerateResponse, Message, ModelProvider, ToolCall } from "./types.js";
import { withRetry } from "./retry.js";

export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_GROQ_TIMEOUT_MS = 60_000;
const SDK_TIMEOUT_GRACE_MS = 1_000;

export interface GroqProviderOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  client?: Pick<Groq, "chat">;
}

export function getGroqConfiguration(env: NodeJS.ProcessEnv = process.env): { apiKey: string; model: string } {
  const apiKey = env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error("GROQ_API_KEY is not set. Add it to your environment or .env file.");
  return { apiKey, model: env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL };
}

export class GroqProvider implements ModelProvider {
  readonly model: string;
  private readonly client: Pick<Groq, "chat">;
  private readonly timeoutMs: number;

  constructor(options: GroqProviderOptions = {}) {
    const config = options.apiKey === undefined
      ? getGroqConfiguration()
      : { apiKey: options.apiKey, model: options.model?.trim() || DEFAULT_GROQ_MODEL };
    if (!config.apiKey.trim()) throw new Error("GROQ_API_KEY is not set. Add it to your environment or .env file.");
    this.model = options.model?.trim() || config.model;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_GROQ_TIMEOUT_MS;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 2 ** 31 - SDK_TIMEOUT_GRACE_MS - 1) {
      throw new RangeError(`timeoutMs must be an integer between 1 and ${2 ** 31 - SDK_TIMEOUT_GRACE_MS - 1}`);
    }
    this.client = options.client ?? new Groq({
      apiKey: config.apiKey,
      maxRetries: 0,
      timeout: this.timeoutMs + SDK_TIMEOUT_GRACE_MS,
    });
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, deadline]) : deadline;
    const tools = request.tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.schema,
      },
    }));

    try {
      const response = await withRetry(
        () => this.client.chat.completions.create({
        model: this.model,
        messages: toGroqMessages(request.system, request.messages),
        ...(request.maxOutputTokens === undefined ? {} : { max_completion_tokens: request.maxOutputTokens }),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(tools.length === 0 ? {} : { tools, tool_choice: "auto" as const }),
        }, {
          signal,
          timeout: this.timeoutMs + SDK_TIMEOUT_GRACE_MS,
          maxRetries: 0,
        }),
        { signal },
      );
      return fromGroqResponse(response);
    } catch (error) {
      if (deadline.aborted && !request.signal?.aborted) throw deadline.reason ?? error;
      throw error;
    }
  }
}

interface GroqRawAssistant {
  provider: "groq";
  message: ChatCompletionAssistantMessageParam;
}

export function toGroqMessages(system: string, messages: Message[]): ChatCompletionMessageParam[] {
  const contents: ChatCompletionMessageParam[] = [{ role: "system", content: system }];
  for (const message of messages) {
    if (message.role === "user") {
      contents.push({ role: "user", content: message.text });
      continue;
    }

    if (message.role === "assistant") {
      const raw = asGroqRawAssistant(message.raw);
      if (raw) {
        contents.push(raw.message);
        continue;
      }

      const toolCalls = message.toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: stringify(call.args) },
      }));
      if (message.text || toolCalls.length > 0) {
        contents.push({ role: "assistant", content: message.text ?? null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
      }
      continue;
    }

    for (const result of message.results) {
      contents.push({
        role: "tool",
        tool_call_id: result.callId,
        content: serializeToolResult(result.result),
      });
    }
  }
  return contents;
}

function asGroqRawAssistant(value: unknown): GroqRawAssistant | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<GroqRawAssistant>;
  if (raw.provider !== "groq" || !raw.message || raw.message.role !== "assistant") return undefined;
  return raw as GroqRawAssistant;
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    // Keep invalid JSON as a string so object-shaped Zod tool schemas reject it.
    return value;
  }
}

function serializeToolResult(value: unknown): string {
  if (typeof value === "string") return value;
  return stringify(value);
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return String(value);
  }
}

export function fromGroqResponse(response: ChatCompletion): GenerateResponse {
  const choice = response.choices?.[0];
  const message = choice?.message;
  const calls = message?.tool_calls ?? [];
  const toolCalls: ToolCall[] = calls.flatMap((call, index) => {
    if (call.type !== "function" || !call.function?.name) return [];
    return [{ id: call.id || `groq-call-${index}`, name: call.function.name, args: parseArguments(call.function.arguments) }];
  });
  if (toolCalls.length === 0 && message?.function_call?.name) {
    toolCalls.push({
      id: "groq-call-0",
      name: message.function_call.name,
      args: parseArguments(message.function_call.arguments),
    });
  }
  const finishReason = mapGroqFinishReason(choice?.finish_reason, toolCalls.length > 0);
  const rawMessage: ChatCompletionAssistantMessageParam | undefined = message
    ? {
        role: "assistant",
        content: message.content,
        ...(message.reasoning == null ? {} : { reasoning: message.reasoning }),
        ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
        ...(message.function_call ? { function_call: message.function_call } : {}),
      }
    : undefined;

  return {
    text: message?.content || undefined,
    toolCalls,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    },
    finishReason,
    raw: rawMessage ? { provider: "groq", message: rawMessage } satisfies GroqRawAssistant : undefined,
  };
}

function mapGroqFinishReason(reason: string | null | undefined, hasToolCalls: boolean): GenerateResponse["finishReason"] {
  if (hasToolCalls || reason === "tool_calls" || reason === "function_call") return "tool_calls";
  switch (reason) {
    case "stop": return "stop";
    case "length": return "length";
    case "content_filter": return "safety";
    default: return "error";
  }
}
