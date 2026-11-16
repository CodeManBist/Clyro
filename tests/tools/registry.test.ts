import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { makeContext } from "./helpers.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import type { ToolDefinition } from "../../src/tools/types.js";

const contexts: Array<() => Promise<void>> = [];
async function context(phase: "investigate" | "propose" | "verify" = "investigate") {
  const value = await makeContext(phase);
  contexts.push(value.cleanup);
  return value.context;
}
afterEach(async () => { await Promise.all(contexts.splice(0).map((cleanup) => cleanup())); });

const sampleSchema = z.object({ value: z.string() });
function definition(overrides: Partial<ToolDefinition<typeof sampleSchema>> = {}): ToolDefinition<typeof sampleSchema> {
  const schema = sampleSchema;
  return {
    name: "sample", description: "sample", permission: "read", phases: ["investigate"], schema,
    modelCallable: true, async execute(args) { return { ok: true, output: args.value }; },
    ...overrides,
  };
}

describe("ToolRegistry", () => {
  it("returns structured unknown, invalid-argument, and wrong-phase results", async () => {
    const registry = new ToolRegistry(); registry.register(definition());
    expect((await registry.execute("missing", {}, await context())).error?.code).toBe("UNKNOWN_TOOL");
    expect((await registry.execute("sample", {}, await context())).error?.code).toBe("INVALID_ARGS");
    expect((await registry.execute("sample", { value: "x" }, await context("verify"))).error?.code).toBe("WRONG_PHASE");
  });

  it("denies permissions not granted to the current phase", async () => {
    const registry = new ToolRegistry();
    registry.register(definition({ permission: "execute", phases: ["investigate"] }));
    expect(await registry.execute("sample", { value: "x" }, await context())).toEqual({
      ok: false, error: { code: "DENIED", message: "Tool permission denied by policy." },
    });
  });

  it("executes, redacts, bounds output, and converts thrown errors", async () => {
    const registry = new ToolRegistry(40);
    registry.register(definition());
    const result = await registry.execute("sample", { value: "AKIA1234567890ABCDEF " + "x".repeat(60) }, await context());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toContain("[REDACTED]");
      expect(result.output).toContain("[OUTPUT TRUNCATED]");
      expect(result.output.length).toBeLessThanOrEqual(40);
    }
    registry.register(definition({ name: "throws", async execute() { throw new Error("secret file content"); } }));
    const failed = await registry.execute("throws", { value: "x" }, await context());
    expect(failed).toEqual({ ok: false, error: { code: "TOOL_FAILED", message: "Tool failed." } });
  });

  it("bounds execution time and responds to cancellation", async () => {
    const registry = new ToolRegistry();
    registry.register(definition({ timeoutMs: 10, async execute(_args, ctx) {
      await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => resolve(), { once: true }));
      return { ok: true, output: "late" };
    } }));
    const result = await registry.execute("sample", { value: "x" }, await context());
    expect(result).toEqual({ ok: false, error: { code: "TIMEOUT", message: "Tool timed out." } });
  });

  it("propagates caller cancellation to a running tool", async () => {
    const registry = new ToolRegistry();
    registry.register(definition({ async execute(_args, ctx) {
      await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => resolve(), { once: true }));
      return { ok: true, output: "cancelled" };
    } }));
    const value = await makeContext();
    contexts.push(value.cleanup);
    const resultPromise = registry.execute("sample", { value: "x" }, value.context);
    value.abort();
    expect(await resultPromise).toEqual({ ok: false, error: { code: "TOOL_FAILED", message: "Tool call cancelled." } });
  });
});
