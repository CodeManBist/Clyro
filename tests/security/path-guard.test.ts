import {
    mkdtemp,
    mkdir,
    rm,
    writeFile,
  symlink,
  } from "node:fs/promises";
  
  import os from "node:os";
  import path from "node:path";
  
  import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
  } from "vitest";
  
  import { PathGuard } from "../../src/security/path-guard.js";
  
  describe("PathGuard", () => {
    let temporaryDirectory: string;
    let repositoryRoot: string;
    let guard: PathGuard;
  
    beforeEach(async () => {
      temporaryDirectory = await mkdtemp(
        path.join(os.tmpdir(), "clyro-guard-"),
      );
  
      repositoryRoot = path.join(
        temporaryDirectory,
        "repository",
      );
  
      await mkdir(path.join(repositoryRoot, "src"), {
        recursive: true,
      });
  
      await writeFile(
        path.join(repositoryRoot, "src", "index.ts"),
        "console.log('Clyro');",
      );
  
      guard = await PathGuard.create(repositoryRoot);
    });
  
    afterEach(async () => {
      await rm(temporaryDirectory, {
        recursive: true,
        force: true,
      });
    });
  
    it("allows paths inside the repository", async () => {
      const resolved = await guard.resolve("src/index.ts");
  
      expect(guard.toRelative(resolved)).toBe("src/index.ts");
    });
  
    it("rejects directory traversal", async () => {
      await expect(
        guard.resolve("../../outside.txt"),
      ).rejects.toMatchObject({
        code: "OUTSIDE_ROOT",
      });
    });
  
    it("rejects absolute paths outside the repository", async () => {
      const outsideFile = path.join(
        temporaryDirectory,
        "secret.txt",
      );
  
      await writeFile(outsideFile, "private data");
  
      await expect(
        guard.resolve(outsideFile),
      ).rejects.toMatchObject({
        code: "OUTSIDE_ROOT",
      });
    });
  
    it("rejects null bytes in paths", async () => {
      await expect(
        guard.resolve("src/index.ts\0"),
      ).rejects.toMatchObject({
        code: "INVALID_PATH",
      });
    });

  it("rejects a sibling directory sharing the repository prefix", async () => {
    const sibling = path.join(temporaryDirectory, "repository-escape");
    await mkdir(sibling);
    await writeFile(path.join(sibling, "secret.txt"), "private");
    await expect(guard.resolve("../repository-escape/secret.txt")).rejects.toMatchObject({ code: "OUTSIDE_ROOT" });
  });

  it("rejects symlink escapes and dangling symlinks where symlinks are supported", async () => {
    const outsideFile = path.join(temporaryDirectory, "outside.txt");
    await writeFile(outsideFile, "private");
    const outsideLink = path.join(repositoryRoot, "outside-link.txt");
    const chainLink = path.join(repositoryRoot, "chain-link.txt");
    const danglingLink = path.join(repositoryRoot, "dangling-link.txt");
    try {
      await symlink(outsideFile, outsideLink, "file");
      await symlink(outsideLink, chainLink, "file");
      await symlink(path.join(temporaryDirectory, "missing-target"), danglingLink, "file");
    } catch {
      return;
    }
    await expect(guard.resolve("outside-link.txt")).rejects.toMatchObject({ code: "OUTSIDE_ROOT" });
    await expect(guard.resolve("chain-link.txt")).rejects.toMatchObject({ code: "OUTSIDE_ROOT" });
    await expect(guard.resolve("dangling-link.txt")).rejects.toMatchObject({ code: "SYMLINK" });
  });
});
