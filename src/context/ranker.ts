import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { RepositorySummary } from "../repository/scanner.js";
import type { ImportGraph } from "../repository/import-graph.js";
import { tokenizeTask } from "./tokenize.js";

export interface RankedFile { path: string; score: number; reasons: string[] }
const maxBytes = 200_000;

export async function rankFiles(task: string, _repository: RepositorySummary, graph: ImportGraph, sourceFiles: string[]): Promise<RankedFile[]> {
  const tokens = tokenizeTask(task);
  if (tokens.length === 0) return [];
  const scores = new Map<string, { score: number; reasons: Set<string> }>();
  for (const file of sourceFiles.map((item) => item.replace(/\\/g, "/")).sort()) {
    if (!/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(file) || file.split("/").includes("node_modules")) continue;
    let score = 0; const reasons = new Set<string>();
    const basename = path.posix.basename(file).toLowerCase();
    const directories = path.posix.dirname(file).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    for (const token of tokens) {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(basename)) { score += 9; reasons.add(`filename matches “${token}”`); }
      else if (directories.includes(token)) { score += 3; reasons.add(`directory matches “${token}”`); }
    }
    let contents = "";
    try {
      const absolutePath = path.resolve(_repository.rootPath, file);
      const info = await stat(absolutePath);
      if (info.size <= maxBytes) contents = await readFile(absolutePath, "utf8");
      else { score -= 2; reasons.add("large file penalty"); }
    } catch { /* absent/unreadable source gets path-only scoring */ }
    const exported = contents.matchAll(/\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g);
    for (const match of exported) for (const token of tokens) if (match[1]!.toLowerCase().includes(token)) { score += 7; reasons.add(`exported identifier matches “${token}”`); }
    let contentPoints = 0;
    for (const token of tokens) {
      const matches = contents.match(new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi")) ?? [];
      if (matches.length) { contentPoints += Math.min(matches.length, 5); reasons.add(`content contains “${token}”`); }
    }
    if (contents) score += Math.min(10, contentPoints);
    if (/\.d\.(?:ts|mts|cts)$/.test(file)) { score -= 7; reasons.add("declaration file penalty"); }
    if (/(?:^|\/)(?:generated|__generated__|dist|build)(?:\/|$)/i.test(file) || /\.generated\./i.test(file)) { score -= 7; reasons.add("generated file penalty"); }
    if (/\/index\.[^.]+$/.test(file) && contents && !/\bexport\s+(?:default\s+)?(?:function|class|const|let|var)\b/.test(contents)) { score -= 4; reasons.add("barrel file penalty"); }
    scores.set(file, { score, reasons });
  }
  const snapshot = [...scores].map(([file, data]) => [file, data.score] as const);
  for (const [file, value] of snapshot) {
    for (const related of graph.imports.get(file) ?? []) addRelated(related, value * 0.25, `imports from relevant file ${file}`);
    for (const related of graph.importedBy.get(file) ?? []) addRelated(related, value * 0.25, `imports relevant file ${file}`);
  }
  function addRelated(file: string, value: number, reason: string): void {
    const entry = scores.get(file); if (entry) { entry.score += value; entry.reasons.add(reason); }
  }
  const byStem = new Map<string, string[]>();
  for (const file of scores.keys()) {
    const stem = path.posix.basename(file).replace(/\.(?:test|spec)\.[^.]+$/i, "").replace(/\.[^.]+$/, "").toLowerCase();
    byStem.set(stem, [...(byStem.get(stem) ?? []), file]);
  }
  for (const paths of byStem.values()) if (paths.length > 1) {
    const best = Math.max(...paths.map((file) => scores.get(file)!.score));
    if (best > 0) for (const file of paths) { const data = scores.get(file)!; data.score += best * 0.2; data.reasons.add("paired test/source filename"); }
  }
  return [...scores].filter(([, data]) => data.score > 0)
    .map(([file, data]) => ({ path: file, score: Math.round(data.score * 100) / 100, reasons: [...data.reasons].sort() }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}
