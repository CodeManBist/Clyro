import { z } from "zod";
import { ToolFailure } from "./errors.js";
import { matchesGlob, walkRepositoryFiles } from "./filesystem.js";
import type { ToolDefinition } from "./types.js";

export const listFilesSchema = z.object({
  path: z.string().default("."),
  glob: z.string().max(200).optional(),
  maxResults: z.number().int().min(1).max(2_000).optional(),
  maxDepth: z.number().int().min(0).max(20).optional(),
});

export const listFilesTool: ToolDefinition<typeof listFilesSchema> = {
  name: "list_files",
  description: "List repository files while excluding dependencies, generated content, and sensitive paths.",
  permission: "read",
  phases: ["investigate", "propose", "verify"],
  schema: listFilesSchema,
  timeoutMs: 10_000,
  modelCallable: true,
  async execute(args, context) {
    if (context.signal.aborted) throw new ToolFailure("TOOL_FAILED", "Tool call cancelled.");
    const maxDepth = Math.min(args.maxDepth ?? context.limits.maxDirectoryDepth, context.limits.maxDirectoryDepth);
    const walk = await walkRepositoryFiles(context, args.path, maxDepth);
    const files = walk.files
      .filter((file) => matchesGlob(file, args.glob));
    const limit = Math.min(args.maxResults ?? context.limits.maxListResults, context.limits.maxListResults);
    const shown = files.slice(0, limit);
    if (shown.length === 0 && walk.truncated) throw new ToolFailure("TOO_LARGE", "Repository scan limit reached before matching files were found.");
    if (shown.length === 0) throw new ToolFailure("NO_MATCH", "No files matched.");
    const output = `${shown.join("\n")}${files.length > shown.length ? `\n[RESULTS TRUNCATED: showing ${shown.length} of ${files.length}]` : ""}${walk.truncated ? "\n[SCAN CAPPED AT 10000 FILES]" : ""}`;
    return { ok: true, output, meta: { count: shown.length, total: files.length, scanTruncated: walk.truncated } };
  },
};
