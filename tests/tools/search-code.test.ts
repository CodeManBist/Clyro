import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { searchCodeTool } from "../../src/tools/search-code.js";
import { callTool, makeContext } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];
async function setup() { const value = await makeContext(); cleanups.push(value.cleanup); return value; }
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });

describe("search_code tool", () => {
  it("supports literal and regex search with path and line numbers", async () => {
    const { root, context } = await setup();
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "entry.ts"), "const one = 1;\nfunction detectProject() {}\nconst two = 2;\n");
    const literal = await callTool(searchCodeTool, { pattern: "detectProject", path: "src", glob: "*.ts" }, context);
    expect(literal).toMatchObject({ ok: true, output: "src/entry.ts:2: function detectProject() {}" });
    const regex = await callTool(searchCodeTool, { pattern: "const \\w+", regex: true, path: "src" }, context);
    expect(regex.ok).toBe(true);
    if (regex.ok) expect(regex.output).toContain("src/entry.ts:1:");
  });

  it("does not search secret files and handles invalid or complex regexes", async () => {
    const { root, context } = await setup();
    await writeFile(path.join(root, ".env"), "TOKEN=hidden-search-value");
    await writeFile(path.join(root, "ok.ts"), "safe source");
    expect(await callTool(searchCodeTool, { pattern: "hidden-search-value" }, context)).toMatchObject({ ok: false, error: { code: "NO_MATCH" } });
    expect(await callTool(searchCodeTool, { pattern: "[", regex: true }, context)).toMatchObject({ ok: false, error: { code: "INVALID_ARGS" } });
    expect(await callTool(searchCodeTool, { pattern: "(a+)+$", regex: true }, context)).toMatchObject({ ok: false, error: { code: "INVALID_ARGS" } });
  });

  it("limits matches and redacts matched source lines", async () => {
    const { root, context } = await setup();
    await writeFile(path.join(root, "a.ts"), "TOKEN=secret-value\nneedle one\nneedle two\n");
    const result = await callTool(searchCodeTool, { pattern: "needle|TOKEN", regex: true, maxMatches: 1 }, context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toContain("[REDACTED]");
      expect(result.meta?.truncated).toBe(true);
      expect(result.output).toContain("[MATCH LIMIT REACHED");
    }
  });
});
