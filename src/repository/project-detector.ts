
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { RepositorySummary } from "./scanner.js";
import { detectFrameworks } from "./framework-table.js";
import { z } from "zod";

export interface ProjectProfile {
  packageManager: "pnpm" | "npm" | "yarn" | "bun" | "unknown";
  moduleType: "esm" | "cjs" | "unknown";
  scripts: Record<string, string>;
  testRunner: "vitest" | "jest" | "node-test" | "mocha" | "unknown";
  frameworks: string[];
  entryPoints: {
    path: string;
    source: "main" | "module" | "exports" | "bin" | "convention";
  }[];
  workspaces: string[];
  hasTsconfig: boolean;
  warnings: string[];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parsePnpmWorkspacePatterns(content: string): string[] {
  const patterns: string[] = [];
  let inPackages = false;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!inPackages) {
      if (/^packages\s*:\s*$/.test(trimmed)) {
        inPackages = true;
      }
      continue;
    }

    if (!trimmed || trimmed.startsWith("#")) continue;

    if (!/^\s+-\s+/.test(line)) break;

    const pattern = trimmed
      .replace(/^-\s+/, "")
      .replace(/\s+#.*$/, "")
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");

    if (pattern) patterns.push(pattern);
  }

  return patterns;
}

async function detectPackageManager(
  rootPath: string,
): Promise<{
  packageManager: ProjectProfile["packageManager"];
  warnings: string[];
}> {
  const lockfiles = [
    { file: "pnpm-lock.yaml", manager: "pnpm" },
    { file: "package-lock.json", manager: "npm" },
    { file: "yarn.lock", manager: "yarn" },
    { file: "bun.lock", manager: "bun" },
    { file: "bun.lockb", manager: "bun" },
  ] as const;

  const detectedManagers = new Set<string>();

  for (const lockfile of lockfiles) {
    const exists = await fileExists(
      path.join(rootPath, lockfile.file),
    );

    if (exists) {
      detectedManagers.add(lockfile.manager);
    }
  }

  if (detectedManagers.size === 0) {
    return {
      packageManager: "unknown",
      warnings: [],
    };
  }

  if (detectedManagers.size > 1) {
    return {
      packageManager: "unknown",
      warnings: [
        `Conflicting package manager lockfiles detected: ${[
          ...detectedManagers,
        ].join(", ")}`,
      ],
    };
  }

  return {
    packageManager: [...detectedManagers][0] as ProjectProfile["packageManager"],
    warnings: [],
  };
}

const packageJsonSchema = z.object({
  packageManager: z.string().optional(),
  type: z.string().optional(),
  scripts: z.record(z.string(), z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  main: z.string().optional(),
  module: z.string().optional(),
  bin: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
  exports: z.union([
    z.string(),
    z.record(z.string(), z.unknown()),
  ]).optional(),
  workspaces: z.union([
    z.array(z.string()),
    z.object({
      packages: z.array(z.string()),
    }),
  ]).optional(),
}).passthrough();

function detectTestRunner(
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
  scripts: Record<string, string>,
): ProjectProfile["testRunner"] {
  const installedPackages = new Set([
    ...Object.keys(dependencies),
    ...Object.keys(devDependencies),
  ]);

  if (installedPackages.has("vitest")) return "vitest";
  if (installedPackages.has("jest")) return "jest";
  if (installedPackages.has("mocha")) return "mocha";

  const testScript = scripts.test ?? "";

  if (/\bnode\s+--test\b/.test(testScript)) {
    return "node-test";
  }

  return "unknown";
}

function normalizeEntryPath(entryPath: string): string {
  return entryPath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function collectExportPaths(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectExportPaths);
  }

  return [];
}

function detectEntryPoints(
  packageJson: {
    main?: string;
    module?: string;
    exports?: unknown;
    bin?: string | Record<string, string>;
  },
  summary: RepositorySummary,
): ProjectProfile["entryPoints"] {
  const files = new Set(summary.files);
  const entryPoints: ProjectProfile["entryPoints"] = [];
  const seen = new Set<string>();

  function addEntry(
    entryPath: string,
    source: ProjectProfile["entryPoints"][number]["source"],
  ): void {
    const normalizedPath = normalizeEntryPath(entryPath);

    if (files.has(normalizedPath) && !seen.has(`${source}:${normalizedPath}`)) {
      entryPoints.push({ path: normalizedPath, source });
      seen.add(`${source}:${normalizedPath}`);
    }
  }

  if (packageJson.main) addEntry(packageJson.main, "main");
  if (packageJson.module) addEntry(packageJson.module, "module");

  if (packageJson.exports) {
    for (const exportPath of collectExportPaths(packageJson.exports)) {
      addEntry(exportPath, "exports");
    }
  }

  if (typeof packageJson.bin === "string") {
    addEntry(packageJson.bin, "bin");
  } else if (packageJson.bin) {
    for (const binPath of Object.values(packageJson.bin)) {
      addEntry(binPath, "bin");
    }
  }

  if (entryPoints.length === 0) {
    for (const convention of [
      "src/index.ts",
      "src/index.tsx",
      "src/index.js",
      "src/index.mjs",
      "src/main.ts",
      "src/main.js",
      "index.ts",
      "index.js",
      "main.ts",
      "main.js",
    ]) {
      if (files.has(convention)) {
        addEntry(convention, "convention");
      }
    }
  }

  return entryPoints;
}

export async function detectProject(
  rootPath: string,
  summary: RepositorySummary,
): Promise<ProjectProfile> {
  
  let dependencies: Record<string, string> = {};
  let devDependencies: Record<string, string> = {};

  const detected = await detectPackageManager(rootPath);

  const warnings = [...detected.warnings];

  let packageManager = detected.packageManager;

  let moduleType: ProjectProfile["moduleType"] = "unknown";

  let scripts: Record<string, string> = {};

  let workspaces: string[] = [];

  let entryPoints: ProjectProfile["entryPoints"] = detectEntryPoints(
    {},
    summary,
  );

  try {
    const rawPackageJson: unknown = JSON.parse(
      await readFile(path.join(rootPath, "package.json"), "utf8"),
    );
    const result = packageJsonSchema.safeParse(rawPackageJson);

    if (!result.success) {
      warnings.push("Could not validate package.json.");
    } else {
      const packageJson = result.data;

      if (packageJson.packageManager) {
        const manager = packageJson.packageManager.split("@", 1)[0];
        if (["pnpm", "npm", "yarn", "bun"].includes(manager)) {
          packageManager = manager as ProjectProfile["packageManager"];
        }
      }
      if (packageJson.type === "module") moduleType = "esm";
      else if (packageJson.type === "commonjs") moduleType = "cjs";
      scripts = packageJson.scripts ?? {};

      dependencies = packageJson.dependencies ?? {};
      devDependencies = packageJson.devDependencies ?? {};
      entryPoints = detectEntryPoints(packageJson, summary);

      if (Array.isArray(packageJson.workspaces)) {
        workspaces = packageJson.workspaces;
      } else if (packageJson.workspaces) {
        workspaces = packageJson.workspaces.packages;
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      warnings.push("Could not parse package.json.");
    }
  }

  try {
    const workspaceFile = path.join(rootPath, "pnpm-workspace.yaml");
  
    if (await fileExists(workspaceFile)) {
      const content = await readFile(workspaceFile, "utf8");
  
      workspaces = [
        ...new Set([
          ...workspaces,
          ...parsePnpmWorkspacePatterns(content),
        ]),
      ];
    }
  } catch {
    warnings.push("Could not read pnpm-workspace.yaml.");
  }

  return {
    packageManager,
    moduleType,
    scripts,
    testRunner: detectTestRunner(
      dependencies,
      devDependencies,
      scripts,
    ),
    frameworks: detectFrameworks(dependencies, devDependencies),
    entryPoints,
    workspaces,
    hasTsconfig: summary.files.includes("tsconfig.json"),
    warnings,
  };
}
