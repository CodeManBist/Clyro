
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { runAgent } from "../src/agent.js";
import { FakeProvider } from "../src/providers/fake.js";
import type { GenerateResponse } from "../src/providers/types.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { ToolDefinition } from "../src/tools/types.js";

import { makeContext } from "./tools/helpers.js";

const contexts: Array<() => Promise<void>> = [];

async function createContext() {
  const value = await makeContext();
  contexts.push(value.cleanup);
  return value;
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((cleanup) => cleanup()));
});

const echoSchema = z.object({
  message: z.string(),
});

const echoTool: ToolDefinition<typeof echoSchema> = {
  name: "echo",
  description: "Returns the supplied message.",
  permission: "read",
  phases: ["investigate"],
  schema: echoSchema,
  modelCallable: true,

  async execute(args) {
    return {
      ok: true,
      output: `Echo: ${args.message}`,
    };
  },
};

function response(
  overrides: Partial<GenerateResponse> = {},
): GenerateResponse {
  return {
    text: "Final answer",
    toolCalls: [],
    usage: {
      inputTokens: 10,
      outputTokens: 5,
    },
    finishReason: "stop",
    ...overrides,
  };
}

describe("runAgent", () => {
  it("returns a direct model answer without executing tools", async () => {
    const provider = new FakeProvider([
      response({ text: "Hello from Clyro!" }),
    ]);

    const registry = new ToolRegistry();
    const { context } = await createContext();

    const result = await runAgent("Say hello", {
      provider,
      registry,
      context,
    });

    expect(result.text).toBe("Hello from Clyro!");
    expect(result.iterations).toBe(1);
    expect(result.toolCalls).toBe(0);
    expect(provider.requests).toHaveLength(1);
  });

  it("executes a tool and sends its result back to the model", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);

    const provider = new FakeProvider([
      response({
        text: undefined,
        toolCalls: [
          {
            id: "call_1",
            name: "echo",
            args: { message: "Hello" },
          },
        ],
        finishReason: "tool_calls",
      }),
      response({
        text: "The tool returned: Echo: Hello",
      }),
    ]);

    const { context } = await createContext();

    const result = await runAgent("Use the echo tool", {
      provider,
      registry,
      context,
    });

    expect(result.text).toBe("The tool returned: Echo: Hello");
    expect(result.iterations).toBe(2);
    expect(result.toolCalls).toBe(1);
    expect(provider.requests).toHaveLength(2);

    const secondRequest = provider.requests[1];

    expect(secondRequest.messages).toHaveLength(3);
    expect(secondRequest.messages[1].role).toBe("assistant");
    expect(secondRequest.messages[2].role).toBe("tool");

    if (secondRequest.messages[2].role === "tool") {
      expect(secondRequest.messages[2].results[0]).toMatchObject({
        callId: "call_1",
        name: "echo",
        result: {
          ok: true,
          output: "Echo: Hello",
        },
      });
    }
  });

  it("exposes only available model-callable tools", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);

    const provider = new FakeProvider([
      response({ text: "Done" }),
    ]);

    const { context } = await createContext();

    await runAgent("Inspect the project", {
      provider,
      registry,
      context,
    });

    expect(provider.requests[0].tools).toHaveLength(1);
    expect(provider.requests[0].tools[0].name).toBe("echo");
    expect(provider.requests[0].tools[0].schema).toBeDefined();
  });

  it("stops when the maximum iteration limit is reached", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);

    const provider = new FakeProvider([
      response({
        text: undefined,
        toolCalls: [
          {
            id: "call_1",
            name: "echo",
            args: { message: "First" },
          },
        ],
        finishReason: "tool_calls",
      }),
    ]);

    const { context } = await createContext();

    await expect(
      runAgent("Keep using tools", {
        provider,
        registry,
        context,
        maxIterations: 1,
      }),
    ).rejects.toThrow("Agent reached the maximum iteration limit.");
  });

  it("respects the maximum tool-call limit", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);

    const provider = new FakeProvider([
      response({
        text: undefined,
        toolCalls: [
          {
            id: "call_1",
            name: "echo",
            args: { message: "First" },
          },
          {
            id: "call_2",
            name: "echo",
            args: { message: "Second" },
          },
        ],
        finishReason: "tool_calls",
      }),
      response({ text: "Finished" }),
    ]);

    const { context } = await createContext();

    const result = await runAgent("Use two tools", {
      provider,
      registry,
      context,
      maxToolCalls: 1,
    });

    expect(result.toolCalls).toBe(1);

    const secondRequest = provider.requests[1];
    const toolMessage = secondRequest.messages.find(
      (message) => message.role === "tool",
    );

    expect(toolMessage?.role).toBe("tool");

    if (toolMessage?.role === "tool") {
      expect(toolMessage.results[1].result).toMatchObject({
        ok: false,
        error: {
          code: "TOOL_FAILED",
          message: "Maximum tool-call limit reached.",
        },
      });
    }
  });
});
