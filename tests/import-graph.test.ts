import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildImportGraph, extractImportSpecifiers } from "../src/repository/import-graph.js";

let temp: string;
beforeEach(async () => { temp = await mkdtemp(path.join(os.tmpdir(), "clyro-graph-")); });
afterEach(async () => { await rm(temp, { recursive: true, force: true }); });

describe("extractImportSpecifiers", () => {
  it("extracts imports and re-exports", () => {
    const sourceCode = `
      import { login } from "./auth/login.js";
      import express from "express";
      export { validate } from "./auth/validator.js";
    `;

    const result = extractImportSpecifiers(sourceCode);

    expect(result).toEqual([
      "./auth/login.js",
      "./auth/validator.js",
      "express",
    ]);
  });

  it("returns an empty array when there are no imports", () => {
    const sourceCode = `
      export function greet() {
        return "Hello";
      }
    `;

    expect(extractImportSpecifiers(sourceCode)).toEqual([]);
  });

  it("extracts side-effect, require, and literal dynamic imports deterministically", () => {
    expect(extractImportSpecifiers(`import "./setup"; const a = require("pkg"); import("./lazy");`))
      .toEqual(["./lazy", "./setup", "pkg"]);
  });

  it("resolves extensions, directory indexes, external and unresolved imports, including cycles", async () => {
    await mkdir(path.join(temp, "src", "folder"), { recursive: true });
    await writeFile(path.join(temp, "src", "main.ts"), `import "./a.js"; import "./folder"; import "./missing"; import "lodash";`);
    await writeFile(path.join(temp, "src", "a.ts"), `import "./main";`);
    await writeFile(path.join(temp, "src", "folder", "index.ts"), "export const folder = true;");
    const graph = await buildImportGraph(temp, ["src/main.ts", "src/a.ts", "src/folder/index.ts"]);
    expect(graph.imports.get("src/main.ts")).toEqual(new Set(["src/a.ts", "src/folder/index.ts"]));
    expect(graph.importedBy.get("src/main.ts")).toEqual(new Set(["src/a.ts"]));
    expect(graph.external.get("src/main.ts")).toEqual(new Set(["lodash"]));
    expect(graph.unresolved.get("src/main.ts")).toEqual(["./missing"]);
  });

  it("resolves tsconfig paths aliases", async () => {
    await mkdir(path.join(temp, "src"), { recursive: true });
    await writeFile(path.join(temp, "tsconfig.json"), `{ // comment\n "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }`);
    await writeFile(path.join(temp, "src", "main.ts"), `import "@/thing";`);
    await writeFile(path.join(temp, "src", "thing.ts"), "export const thing = 1;");
    const graph = await buildImportGraph(temp, ["src/main.ts", "src/thing.ts", "tsconfig.json"]);
    expect(graph.imports.get("src/main.ts")).toEqual(new Set(["src/thing.ts"]));
  });
});
