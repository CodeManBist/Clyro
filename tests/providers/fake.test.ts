import { describe, expect, it } from "vitest";
import { FakeProvider } from "../../src/providers/fake.js";
import type { GenerateRequest, GenerateResponse } from "../../src/providers/types.js";

const request: GenerateRequest = { system: "be useful", messages: [], tools: [] };
const response: GenerateResponse = {
  text: "hello", toolCalls: [], usage: { inputTokens: 1, outputTokens: 2 }, finishReason: "stop",
};

describe("FakeProvider", () => {
  it("returns scripted responses in order and records requests", async () => {
    const provider = new FakeProvider([response, { ...response, text: "second" }]);
    await expect(provider.generate(request)).resolves.toBe(response);
    await expect(provider.generate(request)).resolves.toMatchObject({ text: "second" });
    expect(provider.requests).toEqual([request, request]);
  });

  it("throws scripted errors and reports exhausted scripts", async () => {
    const expected = new Error("offline failure");
    const provider = new FakeProvider([expected]);
    await expect(provider.generate(request)).rejects.toBe(expected);
    await expect(provider.generate(request)).rejects.toThrow("No scripted response available");
    expect(provider.requests).toHaveLength(2);
  });
});
