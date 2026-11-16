import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listFilesTool } from "../../src/tools/list-files.js";
import { callTool, makeContext } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];
async function setup() { const value = await makeContext(); cleanups.push(value.cleanup); return value; }
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });

describe("list_files tool", () => {
  it("lists nested ordinary files deterministically and filters sensitive/generated paths", async () => {
    const { root, context } = await setup();
    await mkdir(path.join(root, "src", "nested"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(path.join(root, "src", "nested", "b.ts"), "");
    await writeFile(path.join(root, "src", "a.ts"), "");
    await writeFile(path.join(root, ".env"), "hidden");
    await writeFile(path.join(root, "node_modules", "pkg", "index.js"), "");
    const result = await callTool(listFilesTool, { path: "src", maxDepth: 2, glob: "**/*.ts" }, context);
    expect(result).toMatchObject({ ok: true, output: "src/a.ts\nsrc/nested/b.ts" });
  });

  it("enforces the requested result limit", async () => {
    const { root, context } = await setup();
    for (const name of ["a.ts", "b.ts", "c.ts"]) await writeFile(path.join(root, name), "");
    const result = await callTool(listFilesTool, { maxResults: 2 }, context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toContain("[RESULTS TRUNCATED: showing 2 of 3]");
  });
});
