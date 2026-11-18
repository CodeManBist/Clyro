
export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface ToolDeclaration {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

export type Message =
  | {
      role: "user";
      text: string;
    }
  | {
      role: "assistant";
      text?: string;
      toolCalls: ToolCall[];
      raw?: unknown;
    }
  | {
      role: "tool";
      results: {
        callId: string;
        name: string;
        result: unknown;
      }[];
    };

export interface GenerateRequest {
  system: string;
  messages: Message[];
  tools: ToolDeclaration[];
  signal?: AbortSignal;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface GenerateResponse {
  text?: string;
  toolCalls: ToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  finishReason: "stop" | "tool_calls" | "length" | "safety" | "error";
  raw?: unknown;
}

export interface ModelProvider {
  generate(request: GenerateRequest): Promise<GenerateResponse>;
}
