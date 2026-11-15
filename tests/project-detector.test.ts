
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanRepository } from "../src/repository/scanner.js";
import { detectProject } from "../src/repository/project-detector.js";

describe("detectProject - package manager", () => {
  let temporaryDirectory: string;
  let repositoryRoot: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), "clyro-project-"),
    );

    repositoryRoot = path.join(temporaryDirectory, "repository");

    await mkdir(repositoryRoot);
  });

  afterEach(async () => {
    await rm(temporaryDirectory, {
      recursive: true,
      force: true,
    });
  });

  async function detect() {
    const summary = await scanRepository(repositoryRoot);
    return detectProject(repositoryRoot, summary);
  }

  it("detects pnpm from pnpm-lock.yaml", async () => {
    await writeFile(
      path.join(repositoryRoot, "pnpm-lock.yaml"),
      "",
    );

    const profile = await detect();

    expect(profile.packageManager).toBe("pnpm");
  });

  it("detects npm from package-lock.json", async () => {
    await writeFile(
      path.join(repositoryRoot, "package-lock.json"),
      "{}",
    );

    const profile = await detect();

    expect(profile.packageManager).toBe("npm");
  });

  it("detects yarn from yarn.lock", async () => {
    await writeFile(
      path.join(repositoryRoot, "yarn.lock"),
      "",
    );

    const profile = await detect();

    expect(profile.packageManager).toBe("yarn");
  });

  it("detects bun from bun.lock", async () => {
    await writeFile(
      path.join(repositoryRoot, "bun.lock"),
      "",
    );

    const profile = await detect();

    expect(profile.packageManager).toBe("bun");
  });

  it("returns unknown when no lockfile exists", async () => {
    const profile = await detect();

    expect(profile.packageManager).toBe("unknown");
  });

  it("returns unknown and a warning for conflicting lockfiles", async () => {
    await writeFile(
      path.join(repositoryRoot, "pnpm-lock.yaml"),
      "",
    );

    await writeFile(
      path.join(repositoryRoot, "package-lock.json"),
      "{}",
    );

    const profile = await detect();

    expect(profile.packageManager).toBe("unknown");
    expect(profile.warnings.length).toBeGreaterThan(0);
  });
});
