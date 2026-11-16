import type { ZodType } from "zod";
import type { PathGuard } from "../security/path-guard.js";

export type Permission = "read" | "propose" | "execute" | "control";
export type AgentPhase = "investigate" | "propose" | "verify";

export type ToolErrorCode =
  | "UNKNOWN_TOOL" | "WRONG_PHASE" | "INVALID_ARGS" | "DENIED"
  | "NOT_FOUND" | "TOO_LARGE" | "NO_MATCH" | "AMBIGUOUS_MATCH"
  | "TIMEOUT" | "TOOL_FAILED";

export type ToolResult =
  | { ok: true; output: string; meta?: Record<string, unknown> }
  | { ok: false; error: { code: ToolErrorCode; message: string } };

export interface ToolLimits {
  maxOutputChars: number;
  maxFileBytes: number;
  maxReadOutputChars: number;
  maxSearchMatches: number;
  maxListResults: number;
  maxDirectoryDepth: number;
}

export interface ToolContext {
  pathGuard: PathGuard;
  repositoryRoot: string;
  phase: AgentPhase;
  limits: ToolLimits;
  signal: AbortSignal;
  filesRead: Map<string, string>;
}

export interface ToolDefinition<S extends ZodType = ZodType> {
  name: string;
  description: string;
  permission: Permission;
  phases: readonly AgentPhase[];
  schema: S;
  timeoutMs?: number;
  modelCallable: boolean;
  execute: (args: S["_output"], context: ToolContext) => Promise<ToolResult>;
}
