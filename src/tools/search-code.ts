import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { redactSecrets } from "../security/redact.js";
import { ToolFailure } from "./errors.js";
import { matchesGlob, resolveRepositoryPath, walkRepositoryFiles } from "./filesystem.js";
import type { ToolDefinition } from "./types.js";

const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const maxLineChars = 8_192;

export const searchCodeSchema = z.object({
  pattern: z.string().min(1).max(200),
  regex: z.boolean().default(false),
  glob: z.string().max(200).optional(),
  path: z.string().default("."),
  maxMatches: z.number().int().min(1).max(1_000).optional(),
});

function makeMatcher(pattern: string, regex: boolean): RegExp {
  if (!regex) return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  let depth = 0;
  let nestedGroups = false;
  for (const char of pattern) {
    if (char === "(" && ++depth > 1) nestedGroups = true;
    if (char === ")") depth--;
  }
  if (nestedGroups || /(?:\([^)]*[+*{][^)]*\)|\([^)]*\|[^)]*\))[+*{]/.test(pattern) || /\\[1-9]/.test(pattern)) {
    throw new ToolFailure("INVALID_ARGS", "Regular expression is too complex.");
  }
  try { return new RegExp(pattern, "i"); }
  catch { throw new ToolFailure("INVALID_ARGS", "Invalid regular expression."); }
}

export const searchCodeTool: ToolDefinition<typeof searchCodeSchema> = {
  name: "search_code",
  description: "Search bounded JavaScript and TypeScript source files for literal text or a constrained regular expression.",
  permission: "read",
  phases: ["investigate", "propose", "verify"],
  schema: searchCodeSchema,
  timeoutMs: 15_000,
  modelCallable: true,
  async execute(args, context) {
    const matcher = makeMatcher(args.pattern, args.regex);
    const walk = await walkRepositoryFiles(context, args.path, context.limits.maxDirectoryDepth);
    const files = walk.files
      .filter((file) => sourceExtensions.has(file.slice(file.lastIndexOf(".")).toLowerCase()))
      .filter((file) => matchesGlob(file, args.glob));
    const maxMatches = Math.min(args.maxMatches ?? context.limits.maxSearchMatches, context.limits.maxSearchMatches);
    const maxBytes = Math.min(context.limits.maxFileBytes, 1_000_000);
    const matches: string[] = [];
    let truncated = walk.truncated;
    for (const file of files) {
      if (context.signal.aborted) throw new ToolFailure("TOOL_FAILED", "Tool call cancelled.");
      const resolved = await resolveRepositoryPath(context, file);
      let info;
      try { info = await stat(resolved.absolute); } catch { continue; }
      if (!info.isFile() || info.size > maxBytes) continue;
      let bytes: Buffer;
      try { bytes = await readFile(resolved.absolute); } catch { continue; }
      if (bytes.includes(0)) continue;
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { continue; }
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!;
        if (matcher.test(line.slice(0, maxLineChars))) {
          matches.push(`${resolved.relative}:${index + 1}: ${redactSecrets(line.slice(0, maxLineChars))}${line.length > maxLineChars ? " [LINE TRUNCATED]" : ""}`);
          if (matches.length >= maxMatches) { truncated = true; break; }
        }
        matcher.lastIndex = 0;
      }
      if (truncated) break;
    }
    if (matches.length === 0 && walk.truncated) throw new ToolFailure("TOO_LARGE", "Repository scan limit reached before matches were found.");
    if (matches.length === 0) throw new ToolFailure("NO_MATCH", "No matches found.");
    const output = `${matches.join("\n")}${truncated ? "\n[MATCH LIMIT REACHED; MORE RESULTS MAY EXIST]" : ""}`;
    return { ok: true, output, meta: { count: matches.length, truncated } };
  },
};
