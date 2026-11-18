import { createProviderRouter, describeProviderFailure, ProviderFailoverError } from "../../providers/fallback.js";
import { redactSecrets } from "../../security/redact.js";

export async function runPing(): Promise<void> {
  const startedAt = Date.now();
  let router: ReturnType<typeof createProviderRouter> | undefined;
  try {
    router = createProviderRouter();
    console.log(`primary provider: ${router.primary.name}`);
    console.log(`model: ${router.primary.model}`);
    if (router.fallback) console.log(`fallback provider: ${router.fallback.name}`);

    const { response, metadata } = await router.generateWithMetadata({
      system: "Reply with only the word OK.",
      messages: [{ role: "user", text: "Ping" }],
      tools: [],
      maxOutputTokens: 8,
      temperature: 0,
    });

    console.log("status: ok");
    console.log(`usage: ${response.usage.inputTokens} in / ${response.usage.outputTokens} out tokens`);
    console.log(`latency: ${Date.now() - startedAt} ms`);
    console.log(`fallback attempted: ${metadata.fallbackAttempted ? "yes" : "no"}`);
    console.log(`responded via: ${metadata.respondingProvider} (${metadata.respondingModel})`);
    if (metadata.fallbackAttempted) {
      console.warn(`warning: primary ${metadata.primaryProvider} failed transiently; fallback ${metadata.respondingProvider} responded`);
    }
  } catch (error) {
    if (!router) {
      const configuredProvider = process.env.AI_PROVIDER?.trim().toLowerCase();
      console.error(`primary provider: ${configuredProvider === "groq" ? "groq" : "gemini"}`);
    }
    console.error("status: error");
    console.error(`fallback attempted: ${error instanceof ProviderFailoverError ? "yes" : "no"}`);
    const message = error instanceof ProviderFailoverError
      ? error.message
      : error instanceof Error && /API_KEY is required|AI_PROVIDER|AI_FALLBACK_PROVIDER/.test(error.message)
        ? redactSecrets(error.message)
        : describeProviderFailure(error);
    console.error(`message: ${redactSecrets(message)}`);
    console.error(`latency: ${Date.now() - startedAt} ms`);
    process.exitCode = 1;
  }
}
