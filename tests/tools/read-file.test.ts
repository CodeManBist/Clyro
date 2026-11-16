import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readFileTool } from "../../src/tools/read-file.js";
import { callTool, makeContext } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];
async function setup() { const value = await makeContext(); cleanups.push(value.cleanup); return value; }
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });

describe("read_file tool", () => {
  it("reads bounded text, supports line ranges, records a hash, and redacts values", async () => {
    const { root, context } = await setup();
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "a.ts"), "first\nTOKEN=super-secret-value\nthird\n");
    const result = await callTool(readFileTool, { path: "src/a.ts", startLine: 2, endLine: 2 }, context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toContain("2: TOKEN=[REDACTED]");
    expect(context.filesRead.get("src/a.ts")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns safe errors for missing, secret, outside, binary, and oversized files", async () => {
    const { root, context } = await setup();
    await writeFile(path.join(root, ".env"), "hidden-value");
    await writeFile(path.join(root, "binary.bin"), Buffer.from([0, 1, 2]));
    await writeFile(path.join(root, "large.txt"), "123456");
    const missing = await callTool(readFileTool, { path: "missing.txt" }, context);
    expect(missing).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    const secret = await callTool(readFileTool, { path: ".env" }, context);
    expect(secret).toEqual({ ok: false, error: { code: "DENIED", message: "access denied by policy" } });
    expect(JSON.stringify(secret)).not.toContain("hidden-value");
    const outside = await callTool(readFileTool, { path: "../outside.txt" }, context);
    expect(outside).toMatchObject({ ok: false, error: { code: "DENIED" } });
    const binary = await callTool(readFileTool, { path: "binary.bin" }, context);
    expect(binary).toMatchObject({ ok: false, error: { code: "INVALID_ARGS" } });
    context.limits.maxFileBytes = 5;
    const large = await callTool(readFileTool, { path: "large.txt" }, context);
    expect(large).toMatchObject({ ok: false, error: { code: "TOO_LARGE" } });
  });
});
