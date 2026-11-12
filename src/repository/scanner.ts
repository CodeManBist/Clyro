import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

const ignoredDirectories = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
]);

export interface RepositorySummary {
  rootPath: string;
  files: string[];
  directories: string[];
  totalFiles: number;
  totalDirectories: number;
  typescriptFiles: number;
  tsxFiles: number;
}

export async function scanRepository(rootPath: string): Promise<RepositorySummary> {
  const resolvedRoot = path.resolve(rootPath);
  let rootInfo;

  try {
    rootInfo = await lstat(resolvedRoot);
  } catch (error) {
    throw new Error(`Cannot access repository directory: ${resolvedRoot}`, { cause: error });
  }

  if (!rootInfo.isDirectory()) {
    throw new Error(`Repository path is not a directory: ${resolvedRoot}`);
  }

  const files: string[] = [];
  const directories: string[] = [];

  async function visitDirectory(directoryPath: string): Promise<void> {
    let entries;

    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      throw new Error(`Cannot read repository directory: ${directoryPath}`, { cause: error });
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
        continue;
      }

      const entryPath = path.join(directoryPath, entry.name);
      const relativePath = path.relative(resolvedRoot, entryPath).split(path.sep).join("/");

      if (entry.isDirectory()) {
        directories.push(relativePath);
        await visitDirectory(entryPath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  await visitDirectory(resolvedRoot);

  files.sort();
  directories.sort();

  const tsxFiles = files.filter((file) => file.endsWith(".tsx")).length;
  const tsFiles = files.filter((file) => file.endsWith(".ts")).length;

  return {
    rootPath: resolvedRoot,
    files,
    directories,
    totalFiles: files.length,
    totalDirectories: directories.length,
    typescriptFiles: tsFiles + tsxFiles,
    tsxFiles,
  };
}
