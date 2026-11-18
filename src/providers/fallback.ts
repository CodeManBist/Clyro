import { GeminiProvider, DEFAULT_GEMINI_MODEL } from "./gemini.js";
import { GroqProvider, DEFAULT_GROQ_MODEL } from "./groq.js";
import { getProviderErrorStatus, isRetryableProviderError } from "./retry.js";
import type { GenerateRequest, GenerateResponse, ModelProvider } from "./types.js";

export type ProviderName = "gemini" | "groq";

export interface ProviderSettings {
  name: ProviderName;
  apiKey: string;
  model: string;
}

export interface ProviderPlan {
  primary: ProviderSettings;
  fallback?: ProviderSettings;
}

interface ProviderEntry extends ProviderSettings {
  provider: ModelProvider;
}

export interface ProviderAttemptMetadata {
  primaryProvider: ProviderName;
  primaryModel: string;
  fallbackProvider?: ProviderName;
  fallbackModel?: string;
  fallbackAttempted: boolean;
  respondingProvider: ProviderName;
  respondingModel: string;
}

export interface ProviderGenerationResult {
  response: GenerateResponse;
  metadata: ProviderAttemptMetadata;
}

export interface ProviderConstructors {
  gemini?: (settings: ProviderSettings) => ModelProvider;
  groq?: (settings: ProviderSettings) => ModelProvider;
}

export class ProviderFailoverError extends Error {
  constructor(
    readonly primaryProvider: ProviderName,
    readonly fallbackProvider: ProviderName,
    primaryFailure: unknown,
    fallbackFailure: unknown,
  ) {
    super(
      `Primary provider ${primaryProvider} failed (${describeFailure(primaryFailure)}); ` +
      `fallback provider ${fallbackProvider} failed (${describeFailure(fallbackFailure)}).`,
    );
    this.name = "ProviderFailoverError";
  }
}

export function resolveProviderPlan(env: NodeJS.ProcessEnv = process.env): ProviderPlan {
  const primaryName = parseProvider(env.AI_PROVIDER, "AI_PROVIDER", "gemini");
  const fallbackRaw = env.AI_FALLBACK_PROVIDER?.trim();
  const fallbackName = fallbackRaw ? parseProvider(fallbackRaw, "AI_FALLBACK_PROVIDER") : undefined;
  if (fallbackName === primaryName) {
    throw new Error("AI_FALLBACK_PROVIDER must be different from AI_PROVIDER.");
  }

  return {
    primary: settingsFor(primaryName, env),
    fallback: fallbackName ? settingsFor(fallbackName, env) : undefined,
  };
}

export function createProviderRouter(
  env: NodeJS.ProcessEnv = process.env,
  constructors: ProviderConstructors = {},
): FallbackProvider {
  const plan = resolveProviderPlan(env);
  const primary = instantiate(plan.primary, constructors);
  const fallback = plan.fallback ? instantiate(plan.fallback, constructors) : undefined;
  return new FallbackProvider(primary, fallback);
}

export class FallbackProvider implements ModelProvider {
  constructor(
    readonly primary: ProviderEntry,
    readonly fallback?: ProviderEntry,
  ) {}

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    return (await this.generateWithMetadata(request)).response;
  }

  async generateWithMetadata(request: GenerateRequest): Promise<ProviderGenerationResult> {
    if (request.signal?.aborted) throw request.signal.reason ?? new Error("Operation aborted");
    const primaryRequest = forProvider(request, this.primary.name);
    try {
      const response = await this.primary.provider.generate(primaryRequest);
      return {
        response,
        metadata: this.metadata(this.primary, false),
      };
    } catch (primaryFailure) {
      if (!this.fallback || request.signal?.aborted || !isRetryableProviderError(primaryFailure)) {
        throw request.signal?.aborted ? request.signal.reason ?? primaryFailure : primaryFailure;
      }

      try {
        const response = await this.fallback.provider.generate(forProvider(request, this.fallback.name));
        return {
          response,
          metadata: this.metadata(this.fallback, true),
        };
      } catch (fallbackFailure) {
        if (request.signal?.aborted) throw request.signal.reason ?? fallbackFailure;
        throw new ProviderFailoverError(
          this.primary.name,
          this.fallback.name,
          primaryFailure,
          fallbackFailure,
        );
      }
    }
  }

  private metadata(responding: ProviderEntry, fallbackAttempted: boolean): ProviderAttemptMetadata {
    return {
      primaryProvider: this.primary.name,
      primaryModel: this.primary.model,
      fallbackProvider: this.fallback?.name,
      fallbackModel: this.fallback?.model,
      fallbackAttempted,
      respondingProvider: responding.name,
      respondingModel: responding.model,
    };
  }

}

function parseProvider(value: string | undefined, variable: string, defaultValue?: ProviderName): ProviderName {
  const normalized = value?.trim().toLowerCase() || defaultValue;
  if (normalized === "gemini" || normalized === "groq") return normalized;
  throw new Error(`${variable} must be either "gemini" or "groq".`);
}

function settingsFor(name: ProviderName, env: NodeJS.ProcessEnv): ProviderSettings {
  const apiKey = name === "gemini" ? env.GEMINI_API_KEY?.trim() : env.GROQ_API_KEY?.trim();
  const model = name === "gemini"
    ? env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL
    : env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL;
  const keyVariable = name === "gemini" ? "GEMINI_API_KEY" : "GROQ_API_KEY";
  if (!apiKey) throw new Error(`${keyVariable} is required for the configured ${name} provider.`);
  return { name, apiKey, model };
}

function instantiate(settings: ProviderSettings, constructors: ProviderConstructors): ProviderEntry {
  const provider = settings.name === "gemini"
    ? (constructors.gemini ?? ((config) => new GeminiProvider(config)))(settings)
    : (constructors.groq ?? ((config) => new GroqProvider(config)))(settings);
  return { ...settings, provider };
}

function forProvider(request: GenerateRequest, provider: ProviderName): GenerateRequest {
  return {
    ...request,
    messages: request.messages.map((message) => {
      if (message.role !== "assistant" || message.raw === undefined) return message;
      const creator = rawProvider(message.raw);
      if (creator === provider) return message;
      const { raw: _raw, ...neutralMessage } = message;
      return neutralMessage;
    }),
  };
}

function rawProvider(raw: unknown): ProviderName | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as { provider?: unknown; role?: unknown; parts?: unknown };
  if (value.provider === "groq") return "groq";
  if (value.role === "model" && Array.isArray(value.parts)) return "gemini";
  return undefined;
}

export function describeProviderFailure(error: unknown): string {
  const status = getProviderErrorStatus(error);
  const typedError = error instanceof Error ? error : undefined;
  const constructorName = error && typeof error === "object"
    ? (error as { constructor?: { name?: unknown } }).constructor?.name
    : undefined;
  const type = typedError?.name && typedError.name !== "Error" ? typedError.name : constructorName;
  const safeType = typeof type === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(type) ? type : "Error";
  return status === undefined ? safeType : `HTTP ${status} ${safeType}`;
}

function describeFailure(error: unknown): string {
  return describeProviderFailure(error);
}
