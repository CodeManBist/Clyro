
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { RepositorySummary } from "./scanner.js";
import { z } from "zod";

export interface ProjectProfile {
  packageManager: "pnpm" | "npm" | "yarn" | "bun" | "unknown";
  moduleType: "esm" | "cjs" | "unknown";
  scripts: Record<string, string>;
  testRunner: "vitest" | "jest" | "node-test" | "mocha" | "unknown";
  frameworks: string[];
  entryPoints: {
    path: string;
    source: "main" | "exports" | "bin" | "convention";
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
  workspaces: z.union([
    z.array(z.string()),
    z.object({
      packages: z.array(z.string()),
    }),
  ]).optional(),
}).passthrough();

export async function detectProject(
  rootPath: string,
  summary: RepositorySummary,
): Promise<ProjectProfile> {
  const detected = await detectPackageManager(rootPath);
  const warnings = [...detected.warnings];
  let packageManager = detected.packageManager;
  let moduleType: ProjectProfile["moduleType"] = "unknown";
  let scripts: Record<string, string> = {};

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
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      warnings.push("Could not parse package.json.");
    }
  }

  return {
    packageManager,
    moduleType,
    scripts,
    testRunner: "unknown",
    frameworks: [],
    entryPoints: [],
    workspaces: [],
    hasTsconfig: summary.files.includes("tsconfig.json"),
    warnings,
  };
}
