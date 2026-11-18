import { DEFAULT_GEMINI_MODEL, GeminiProvider } from "../../providers/gemini.js";
import { redactSecrets } from "../../security/redact.js";

export async function runPing(): Promise<void> {
  const startedAt = Date.now();
  const configuredModel = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  console.log("provider: gemini");
  console.log(`model: ${configuredModel}`);
  try {
    const provider = new GeminiProvider();
    const response = await provider.generate({
      system: "Reply with only the word OK.",
      messages: [{ role: "user", text: "Ping" }],
      tools: [],
      maxOutputTokens: 8,
      temperature: 0,
    });

    console.log("status: ok");
    console.log(`usage: ${response.usage.inputTokens} in / ${response.usage.outputTokens} out tokens`);
    console.log(`latency: ${Date.now() - startedAt} ms`);
  } catch (error) {
    console.error("status: error");
    const message = error instanceof Error ? redactSecrets(error.message) : "Unknown provider error";
    console.error(`message: ${message}`);
    console.error(`latency: ${Date.now() - startedAt} ms`);
    process.exitCode = 1;
  }
}
