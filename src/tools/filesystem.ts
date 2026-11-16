import { lstat, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { GuardError } from "../security/path-guard.js";
import { isSecretPath } from "../security/secrets.js";
import { ToolFailure } from "./errors.js";
import type { ToolContext } from "./types.js";

export async function resolveRepositoryPath(context: ToolContext, requested: string): Promise<{ absolute: string; relative: string }> {
  try {
    const absolute = await context.pathGuard.resolve(requested);
    const relative = context.pathGuard.toRelative(absolute);
    if (isSecretPath(requested) || isSecretPath(relative)) throw new ToolFailure("DENIED", "access denied by policy");
    return { absolute, relative };
  } catch (error) {
    if (error instanceof ToolFailure) throw error;
    if (error instanceof GuardError && ["OUTSIDE_ROOT", "SYMLINK"].includes(error.code)) {
      throw new ToolFailure("DENIED", "access denied by policy");
    }
    if (error instanceof GuardError && error.code === "INVALID_PATH") throw new ToolFailure("INVALID_ARGS", "Path is invalid.");
    throw new ToolFailure("NOT_FOUND", "Path was not found.");
  }
}

export function matchesGlob(filePath: string, glob: string | undefined): boolean {
  if (!glob) return true;
  const normalized = glob.replace(/\\/g, "/").replace(/^\.\//, "");
  let expression = "^";
  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index]!;
    if (char === "*") {
      if (normalized[index + 1] === "*") {
        index++;
        if (normalized[index + 1] === "/") { index++; expression += "(?:.*/)?"; }
        else expression += ".*";
      } else expression += "[^/]*";
    } else if (char === "?") expression += "[^/]";
    else expression += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  expression += "$";
  const matcher = new RegExp(expression, "i");
  return matcher.test(filePath) || matcher.test(path.posix.basename(filePath));
}

const ignoredDirectories = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo", ".cache", "out", "vendor", "generated", "__generated__"]);

export async function walkRepositoryFiles(context: ToolContext, directory: string, maxDepth: number): Promise<{ files: string[]; truncated: boolean }> {
  const start = await resolveRepositoryPath(context, directory);
  if (ignoredDirectories.has(path.basename(start.absolute).toLowerCase())) return { files: [], truncated: false };
  try {
    if ((await lstat(path.resolve(context.repositoryRoot, directory))).isSymbolicLink()) {
      throw new ToolFailure("DENIED", "access denied by policy");
    }
  } catch (error) {
    if (error instanceof ToolFailure) throw error;
  }
  let info;
  try { info = await stat(start.absolute); }
  catch { throw new ToolFailure("NOT_FOUND", "Directory was not found."); }
  if (!info.isDirectory()) throw new ToolFailure("INVALID_ARGS", "Path must be a directory.");
  const results: string[] = [];
  let truncated = false;
  async function walk(absolute: string, relative: string, depth: number): Promise<void> {
    if (context.signal.aborted) throw new ToolFailure("TOOL_FAILED", "Tool call cancelled.");
    let entries;
    try { entries = await readdir(absolute, { withFileTypes: true }); }
    catch { return; }
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      if (context.signal.aborted) throw new ToolFailure("TOOL_FAILED", "Tool call cancelled.");
      if (truncated) return;
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (isSecretPath(childRelative) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (depth < maxDepth && !ignoredDirectories.has(entry.name.toLowerCase())) {
          await walk(path.join(absolute, entry.name), childRelative, depth + 1);
        }
      } else if (entry.isFile()) {
        if (results.length >= 10_000) { truncated = true; return; }
        results.push(childRelative.replace(/\\/g, "/"));
      }
    }
  }
  await walk(start.absolute, start.relative, 0);
  return { files: results.sort(), truncated };
}
