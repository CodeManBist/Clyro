import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PathGuard } from "../../src/security/path-guard.js";
import type { AgentPhase, ToolContext } from "../../src/tools/types.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import type { ToolDefinition } from "../../src/tools/types.js";

export async function makeContext(phase: AgentPhase = "investigate"): Promise<{ root: string; cleanup: () => Promise<void>; context: ToolContext; abort: () => void }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "clyro-tools-"));
  const controller = new AbortController();
  const context: ToolContext = {
    pathGuard: await PathGuard.create(root),
    repositoryRoot: root,
    phase,
    limits: { maxOutputChars: 16_000, maxFileBytes: 1_000_000, maxReadOutputChars: 8_000, maxSearchMatches: 100, maxListResults: 200, maxDirectoryDepth: 8 },
    signal: controller.signal,
    filesRead: new Map(),
  };
  return { root, context, cleanup: async () => rm(root, { recursive: true, force: true }), abort: () => controller.abort() };
}

export async function callTool<S extends import("zod").ZodType>(tool: ToolDefinition<S>, args: unknown, context: ToolContext) {
  const registry = new ToolRegistry();
  registry.register(tool);
  return registry.execute(tool.name, args, context);
}
