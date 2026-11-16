import { redactSecrets } from "../security/redact.js";
import { ToolFailure } from "./errors.js";
import type { AgentPhase, Permission, ToolContext, ToolDefinition, ToolErrorCode, ToolResult } from "./types.js";

interface RegisteredTool {
  permission: Permission;
  phases: readonly AgentPhase[];
  modelCallable: boolean;
  timeoutMs: number;
  invoke: (args: unknown, context: ToolContext) => Promise<ToolResult>;
}

const phasePermissions: Record<AgentPhase, ReadonlySet<Permission>> = {
  investigate: new Set(["read"]),
  propose: new Set(["read", "propose"]),
  verify: new Set(["read", "execute"]),
};

function errorResult(code: ToolErrorCode, message: string): ToolResult {
  return { ok: false, error: { code, message } };
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  constructor(private readonly outputLimit = 16_000) {}

  register<S extends import("zod").ZodType>(definition: ToolDefinition<S>): void {
    if (this.tools.has(definition.name)) throw new Error(`Duplicate tool registration: ${definition.name}`);
    this.tools.set(definition.name, {
      permission: definition.permission,
      phases: definition.phases,
      modelCallable: definition.modelCallable,
      timeoutMs: definition.timeoutMs ?? 10_000,
      invoke: async (args, context) => {
        const parsed = definition.schema.safeParse(args);
        if (!parsed.success) return errorResult("INVALID_ARGS", "Tool arguments are invalid.");
        return definition.execute(parsed.data, context);
      },
    });
  }

  async execute(name: string, rawArgs: unknown, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return errorResult("UNKNOWN_TOOL", "Unknown tool.");
    if (!tool.phases.includes(context.phase)) return errorResult("WRONG_PHASE", "Tool is unavailable in this phase.");
    if (!phasePermissions[context.phase].has(tool.permission) || (tool.modelCallable && tool.permission === "control")) {
      return errorResult("DENIED", "Tool permission denied by policy.");
    }
    if (context.signal.aborted) return errorResult("TOOL_FAILED", "Tool call cancelled.");

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    context.signal.addEventListener("abort", abortFromCaller, { once: true });
    const runContext: ToolContext = { ...context, signal: controller.signal };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      const execution = tool.invoke(rawArgs, runContext);
      const timeout = new Promise<ToolResult>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(errorResult("TIMEOUT", "Tool timed out."));
        }, tool.timeoutMs);
      });
      const cancelled = new Promise<ToolResult>((resolve) => {
        if (context.signal.aborted) resolve(errorResult("TOOL_FAILED", "Tool call cancelled."));
        else {
          cancel = () => resolve(errorResult("TOOL_FAILED", "Tool call cancelled."));
          context.signal.addEventListener("abort", cancel, { once: true });
        }
      });
      const result = await Promise.race([execution, timeout, cancelled]);
      if (!result.ok) {
        const message = redactSecrets(result.error.message);
        const errorLimit = Math.max(0, Math.min(this.outputLimit, context.limits.maxOutputChars));
        return errorResult(result.error.code, message.length > errorLimit ? `${message.slice(0, errorLimit)}…` : message);
      }
      const redacted = redactSecrets(result.output);
      const limit = Math.max(0, Math.min(this.outputLimit, context.limits.maxOutputChars));
      const marker = "\n[OUTPUT TRUNCATED]";
      const output = redacted.length > limit
        ? limit >= marker.length
          ? `${redacted.slice(0, limit - marker.length)}${marker}`
          : "[OUTPUT TRUNCATED]".slice(0, limit)
        : redacted;
      return { ...result, output };
    } catch (error) {
      if (error instanceof ToolFailure) return errorResult(error.code, error.message);
      return errorResult("TOOL_FAILED", "Tool failed.");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      context.signal.removeEventListener("abort", abortFromCaller);
      if (cancel) context.signal.removeEventListener("abort", cancel);
    }
  }
}
