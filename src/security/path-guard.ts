import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

export type GuardErrorCode =
  | "INVALID_PATH"
  | "OUTSIDE_ROOT"
  | "SYMLINK"
  | "PATH_RESOLUTION_FAILED";

export class GuardError extends Error {
  constructor(
    public readonly code: GuardErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GuardError";
  }
}

function isInside(root: string, target: string): boolean {
  const relativePath = path.relative(root, target);

  return (
    relativePath === "" ||
    (
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath)
    )
  );
}

/**
 * Resolves an existing path or the nearest existing parent.
 * This supports paths that do not exist yet while still
 * resolving symlinks in their existing parent directories.
 */
async function realpathOrNearestParent(
  targetPath: string,
): Promise<string> {
  let current = targetPath;
  const missingParts: string[] = [];

  while (true) {
    try {
      const resolved = await realpath(current);

      return path.join(
        resolved,
        ...missingParts.reverse(),
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw new GuardError(
          "PATH_RESOLUTION_FAILED",
          "Could not resolve repository path.",
        );
      }

      // Reject dangling symlinks rather than treating them
      // as ordinary missing files.
      try {
        const info = await lstat(current);

        if (info.isSymbolicLink()) {
          throw new GuardError(
            "SYMLINK",
            "Symbolic links are not allowed.",
          );
        }
      } catch (lstatError) {
        if (lstatError instanceof GuardError) {
          throw lstatError;
        }

        const lstatCode = (
          lstatError as NodeJS.ErrnoException
        ).code;

        if (lstatCode !== "ENOENT" && lstatCode !== "ENOTDIR") {
          throw new GuardError(
            "PATH_RESOLUTION_FAILED",
            "Could not inspect repository path.",
          );
        }
      }

      const parent = path.dirname(current);

      if (parent === current) {
        throw new GuardError(
          "PATH_RESOLUTION_FAILED",
          "Could not resolve repository path.",
        );
      }

      missingParts.push(path.basename(current));
      current = parent;
    }
  }
}

export class PathGuard {
  private constructor(
    private readonly rootReal: string,
  ) {}

  static async create(root: string): Promise<PathGuard> {
    const rootReal = await realpath(root);

    return new PathGuard(rootReal);
  }

  async resolve(input: string): Promise<string> {
    if (input.includes("\0")) {
      throw new GuardError(
        "INVALID_PATH",
        "Path contains a null byte.",
      );
    }

    const absolutePath = path.resolve(
      this.rootReal,
      input,
    );

    // First check the normalized lexical path.
    if (!isInside(this.rootReal, absolutePath)) {
      throw new GuardError(
        "OUTSIDE_ROOT",
        "Access outside the repository is not allowed.",
      );
    }

    // Then resolve symlinks using the filesystem.
    const resolvedPath = await realpathOrNearestParent(
      absolutePath,
    );

    // Verify containment again after canonicalization.
    if (!isInside(this.rootReal, resolvedPath)) {
      throw new GuardError(
        "OUTSIDE_ROOT",
        "Access outside the repository is not allowed.",
      );
    }

    return resolvedPath;
  }

  toRelative(realPath: string): string {
    if (!isInside(this.rootReal, realPath)) {
      throw new GuardError(
        "OUTSIDE_ROOT",
        "Cannot create a relative path outside the repository.",
      );
    }

    return path
      .relative(this.rootReal, realPath)
      .split(path.sep)
      .join("/");
  }
}