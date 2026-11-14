
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

const ignoredDirectories = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
  "out",
]);

const typescriptExtensions = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
]);

const javascriptExtensions = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

export interface RepositorySummary {
  rootPath: string;
  files: string[];
  directories: string[];
  totalFiles: number;
  totalDirectories: number;
  typescriptFiles: number;
  javascriptFiles: number;
  tsxFiles: number;
}

export async function scanRepository(
  rootPath: string,
): Promise<RepositorySummary> {
  const resolvedRoot = path.resolve(rootPath);

  let rootInfo;

  try {
    rootInfo = await lstat(resolvedRoot);
  } catch (error) {
    throw new Error(
      `Cannot access repository directory: ${resolvedRoot}`,
      { cause: error },
    );
  }

  if (!rootInfo.isDirectory()) {
    throw new Error(
      `Repository path is not a directory: ${resolvedRoot}`,
    );
  }

  const files: string[] = [];
  const directories: string[] = [];

  async function visitDirectory(directoryPath: string): Promise<void> {
    let entries;

    try {
      entries = await readdir(directoryPath, {
        withFileTypes: true,
      });
    } catch (error) {
      throw new Error(
        `Cannot read repository directory: ${directoryPath}`,
        { cause: error },
      );
    }

    for (const entry of entries) {
      // Never follow symbolic links.
      if (entry.isSymbolicLink()) {
        continue;
      }

      // Skip ignored directories at every level.
      if (
        entry.isDirectory() &&
        ignoredDirectories.has(entry.name)
      ) {
        continue;
      }

      const entryPath = path.join(directoryPath, entry.name);

      const relativePath = path
        .relative(resolvedRoot, entryPath)
        .split(path.sep)
        .join("/");

      if (entry.isDirectory()) {
        directories.push(relativePath);
        await visitDirectory(entryPath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  await visitDirectory(resolvedRoot);

  // Keep the output deterministic.
  files.sort();
  directories.sort();

  // Classify source files by extension.
  const typescriptFiles = files.filter((file) =>
    typescriptExtensions.has(path.extname(file)),
  ).length;

  const javascriptFiles = files.filter((file) =>
    javascriptExtensions.has(path.extname(file)),
  ).length;

  const tsxFiles = files.filter(
    (file) => path.extname(file) === ".tsx",
  ).length;

  return {
    rootPath: resolvedRoot,
    files,
    directories,
    totalFiles: files.length,
    totalDirectories: directories.length,
    typescriptFiles,
    javascriptFiles,
    tsxFiles,
  };
}
