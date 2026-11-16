import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

export interface ImportGraph {
  imports: Map<string, Set<string>>;
  importedBy: Map<string, Set<string>>;
  external: Map<string, Set<string>>;
  unresolved: Map<string, string[]>;
}

const sourceExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const maxSourceBytes = 1_000_000;

export function extractImportSpecifiers(sourceCode: string): string[] {
  const result = ts.preProcessFile(sourceCode, true, true);
  return [...new Set(result.importedFiles.map((file) => file.fileName))].sort();
}

function normalize(file: string): string {
  return path.posix.normalize(file.replace(/\\/g, "/")).replace(/^\.\//, "");
}

function candidates(specifier: string): string[] {
  const output = [specifier];
  const ext = path.posix.extname(specifier);
  const replacements: Record<string, string[]> = {
    ".js": [".ts", ".tsx", ".mts", ".cts"], ".jsx": [".tsx", ".ts"],
    ".mjs": [".mts", ".ts"], ".cjs": [".cts", ".ts"],
    ".ts": [".tsx"], ".mts": [".ts"], ".cts": [".ts"],
  };
  if (ext) {
    const stem = specifier.slice(0, -ext.length);
    output.push(...(replacements[ext] ?? []).map((replacement) => stem + replacement));
  } else {
    output.push(...sourceExtensions.map((extension) => specifier + extension));
  }
  for (const base of [...output]) output.push(...sourceExtensions.map((extension) => `${base}/index${extension}`));
  return [...new Set(output)];
}

interface ResolverConfig { baseUrl: string; paths: Record<string, string[]> }

function readResolverConfig(rootPath: string): ResolverConfig {
  const configPath = path.join(rootPath, "tsconfig.json");
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error || !loaded.config) return { baseUrl: rootPath, paths: {} };
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, rootPath, undefined, configPath);
  const options = parsed.options;
  return {
    baseUrl: options.baseUrl ? path.resolve(rootPath, options.baseUrl) : rootPath,
    paths: options.paths ?? {},
  };
}

function aliasTargets(specifier: string, config: ResolverConfig): string[] {
  const targets: string[] = [];
  for (const [pattern, values] of Object.entries(config.paths)) {
    const star = pattern.indexOf("*");
    const prefix = star < 0 ? pattern : pattern.slice(0, star);
    const suffix = star < 0 ? "" : pattern.slice(star + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix) || specifier.length < prefix.length + suffix.length) continue;
    const capture = specifier.slice(prefix.length, specifier.length - suffix.length);
    for (const value of values) targets.push(path.resolve(config.baseUrl, value.replace("*", capture)));
  }
  return targets;
}

export function createImportGraph(): ImportGraph {
  return { imports: new Map(), importedBy: new Map(), external: new Map(), unresolved: new Map() };
}

export async function buildImportGraph(rootPath: string, files: string[]): Promise<ImportGraph> {
  const root = path.resolve(rootPath);
  const graph = createImportGraph();
  const known = new Set(files.map(normalize).filter((file) => !file.split("/").includes("node_modules")));
  const config = readResolverConfig(root);
  const sourceFiles = [...known].filter((file) => sourceExtensions.includes(path.posix.extname(file))).sort();
  for (const file of sourceFiles) {
    graph.imports.set(file, new Set());
    graph.importedBy.set(file, new Set());
    graph.external.set(file, new Set());
    graph.unresolved.set(file, []);
  }
  const knownAbsolute = new Set(sourceFiles.map((file) => path.resolve(root, file)));
  for (const file of sourceFiles) {
    let source: string;
    try {
      const absolutePath = path.resolve(root, file);
      if ((await stat(absolutePath)).size > maxSourceBytes) continue;
      source = await readFile(absolutePath, "utf8");
    } catch { continue; }
    const unresolved = graph.unresolved.get(file)!;
    for (const specifier of extractImportSpecifiers(source)) {
      if (!specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("#")) {
        const targets = aliasTargets(specifier, config);
        let resolved: string | undefined;
        for (const target of targets) {
          resolved = candidates(target).map((candidate) => path.resolve(candidate)).find((candidate) => knownAbsolute.has(candidate));
          if (resolved) break;
        }
        if (!resolved) {
          graph.external.get(file)!.add(specifier);
          continue;
        }
        const relative = normalize(path.relative(root, resolved));
        graph.imports.get(file)!.add(relative); graph.importedBy.get(relative)?.add(file); continue;
      }
      const base = specifier.startsWith("/") ? path.resolve(root, `.${specifier}`) : path.resolve(root, path.dirname(file), specifier);
      const resolved = candidates(base).map((candidate) => path.resolve(candidate)).find((candidate) => knownAbsolute.has(candidate));
      if (resolved) {
        const relative = normalize(path.relative(root, resolved));
        graph.imports.get(file)!.add(relative); graph.importedBy.get(relative)?.add(file);
      } else unresolved.push(specifier);
    }
    unresolved.sort();
  }
  return graph;
}
