import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanRepository } from "../src/repository/scanner.js";

describe("scanRepository", () => {
  let temporaryDirectory: string;
  let repositoryRoot: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "clyro-scanner-"));
    repositoryRoot = path.join(temporaryDirectory, "repository");
    await mkdir(repositoryRoot);
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("discovers TypeScript and TSX files", async () => {
    await mkdir(path.join(repositoryRoot, "src"));
    await writeFile(path.join(repositoryRoot, "src", "app.ts"), "");
    await writeFile(path.join(repositoryRoot, "src", "view.tsx"), "");
    await writeFile(path.join(repositoryRoot, "src", "helper.js"), "");

    const summary = await scanRepository(repositoryRoot);

    expect(summary.files).toEqual(["src/app.ts", "src/helper.js", "src/view.tsx"]);
    expect(summary.typescriptFiles).toBe(2);
    expect(summary.tsxFiles).toBe(1);
  });

  it("counts files and directories recursively", async () => {
    await mkdir(path.join(repositoryRoot, "src", "nested"), { recursive: true });
    await writeFile(path.join(repositoryRoot, "README.md"), "");
    await writeFile(path.join(repositoryRoot, "src", "index.ts"), "");
    await writeFile(path.join(repositoryRoot, "src", "nested", "agent.ts"), "");

    const summary = await scanRepository(repositoryRoot);

    expect(summary.totalFiles).toBe(3);
    expect(summary.totalDirectories).toBe(2);
    expect(summary.directories).toEqual(["src", "src/nested"]);
  });

  it("ignores excluded directories at every level", async () => {
    const ignoredNames = ["node_modules", ".git", "dist", "build", ".next", "coverage"];
    for (const name of ignoredNames) {
      const ignoredDirectory = path.join(repositoryRoot, "nested", name);
      await mkdir(ignoredDirectory, { recursive: true });
      await writeFile(path.join(ignoredDirectory, "ignored.ts"), "");
    }
    await writeFile(path.join(repositoryRoot, "included.ts"), "");

    const summary = await scanRepository(repositoryRoot);

    expect(summary.files).toEqual(["included.ts"]);
    expect(summary.directories).toEqual(["nested"]);
    expect(summary.typescriptFiles).toBe(1);
  });

  it("returns zero counts for an empty directory", async () => {
    const summary = await scanRepository(repositoryRoot);

    expect(summary.files).toEqual([]);
    expect(summary.directories).toEqual([]);
    expect(summary.totalFiles).toBe(0);
    expect(summary.totalDirectories).toBe(0);
    expect(summary.typescriptFiles).toBe(0);
    expect(summary.tsxFiles).toBe(0);
  });

  it("reports a clear error for a missing directory", async () => {
    const missingDirectory = path.join(temporaryDirectory, "missing");

    await expect(scanRepository(missingDirectory)).rejects.toThrow(
      `Cannot access repository directory: ${missingDirectory}`,
    );
  });

  it("does not follow symbolic links when supported", async (context) => {
    const outsideDirectory = path.join(temporaryDirectory, "outside");
    await mkdir(outsideDirectory);
    await writeFile(path.join(outsideDirectory, "outside.ts"), "");

    try {
      await symlink(
        outsideDirectory,
        path.join(repositoryRoot, "linked-directory"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (["EPERM", "EACCES", "ENOTSUP", "UNKNOWN"].includes(code ?? "")) {
        context.skip();
      }
      throw error;
    }

    const summary = await scanRepository(repositoryRoot);

    expect(summary.files).toEqual([]);
    expect(summary.directories).toEqual([]);
  });

  
it("detects all JavaScript and TypeScript source extensions", async () => {
  const extensions = [
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
  ];

  for (const extension of extensions) {
    await writeFile(
      path.join(repositoryRoot, `file${extension}`),
      "",
    );
  }

  const summary = await scanRepository(repositoryRoot);

  expect(summary.files).toHaveLength(8);
  expect(summary.typescriptFiles).toBe(4);
  expect(summary.javascriptFiles).toBe(4);
  expect(summary.tsxFiles).toBe(1);
});

  
  it("counts all supported TypeScript and JavaScript extensions", async () => {
    await mkdir(path.join(repositoryRoot, "src"));
  
    const extensions = [
      ".ts",
      ".tsx",
      ".mts",
      ".cts",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
    ];
  
    for (const extension of extensions) {
      await writeFile(
        path.join(repositoryRoot, "src", `file${extension}`),
        "",
      );
    }
  
    const summary = await scanRepository(repositoryRoot);
  
    expect(summary.typescriptFiles).toBe(4);
    expect(summary.javascriptFiles).toBe(4);
    expect(summary.tsxFiles).toBe(1);
    expect(summary.totalFiles).toBe(8);
  });
  
});
