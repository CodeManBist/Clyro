import "dotenv/config";
import { describe, expect, it } from "vitest";
import { GroqProvider } from "../../src/providers/groq.js";

describe.runIf(process.env.GROQ_LIVE === "1")("Groq live API", () => {
  it("returns a response from the configured Groq model", async () => {
    const provider = new GroqProvider();
    const response = await provider.generate({
      system: "Reply with only OK.",
      messages: [{ role: "user", text: "Ping" }],
      tools: [],
      maxOutputTokens: 8,
      temperature: 0,
    });
    expect(response.finishReason).toBe("stop");
    expect(response.text).toBeTruthy();
  }, 90_000);
});
