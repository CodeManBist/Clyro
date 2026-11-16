import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { ToolFailure } from "./errors.js";
import { resolveRepositoryPath } from "./filesystem.js";
import type { ToolDefinition } from "./types.js";

export const readFileSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
}).refine((args) => args.startLine === undefined || args.endLine === undefined || args.endLine >= args.startLine);

export const readFileTool: ToolDefinition<typeof readFileSchema> = {
  name: "read_file",
  description: "Read a bounded, redacted text file inside the repository.",
  permission: "read",
  phases: ["investigate", "propose", "verify"],
  schema: readFileSchema,
  timeoutMs: 5_000,
  modelCallable: true,
  async execute(args, context) {
    const resolved = await resolveRepositoryPath(context, args.path);
    let info;
    try { info = await stat(resolved.absolute); } catch { throw new ToolFailure("NOT_FOUND", "File was not found."); }
    if (!info.isFile()) throw new ToolFailure("INVALID_ARGS", "Path must be a file.");
    const maxBytes = Math.min(1_000_000, context.limits.maxFileBytes);
    if (info.size > maxBytes) throw new ToolFailure("TOO_LARGE", "File exceeds the read size limit.");
    let bytes: Buffer;
    try { bytes = await readFile(resolved.absolute); } catch { throw new ToolFailure("TOOL_FAILED", "File could not be read."); }
    if (bytes.includes(0)) throw new ToolFailure("INVALID_ARGS", "Binary files cannot be read.");
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new ToolFailure("INVALID_ARGS", "File is not valid UTF-8 text."); }
    const hash = createHash("sha256").update(bytes).digest("hex");
    context.filesRead.set(resolved.relative, hash);
    const lines = content.split(/\r?\n/);
    const from = args.startLine ?? 1;
    const to = Math.min(args.endLine ?? lines.length, lines.length);
    const selected = lines.slice(from - 1, to);
    const body = selected.map((line, index) => `${from + index}: ${line}`).join("\n");
    const header = `${resolved.relative} (lines ${from}-${to})\n`;
    const output = `${header}${body}`;
    const limit = Math.max(0, Math.min(8_000, context.limits.maxReadOutputChars, context.limits.maxOutputChars));
    const marker = "\n[CONTENT TRUNCATED]";
    const bounded = output.length > limit
      ? limit >= marker.length
        ? `${output.slice(0, limit - marker.length)}${marker}`
        : "[TRUNCATED]".slice(0, limit)
      : output;
    return { ok: true, output: bounded, meta: { path: resolved.relative, sha256: hash, startLine: from, endLine: to } };
  },
};
