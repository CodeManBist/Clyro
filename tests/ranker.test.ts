import { describe, expect, it } from "vitest";
import { rankFiles } from "../src/context/ranker.js";
import { createImportGraph } from "../src/repository/import-graph.js";
import type { RepositorySummary } from "../src/repository/scanner.js";

describe("rankFiles", () => {
  it("ranks login validation implementation and paired test near the top", async () => {
    const repository: RepositorySummary = { rootPath: new URL("../", import.meta.url).pathname, files: [], directories: [], totalFiles: 0, totalDirectories: 0, typescriptFiles: 0, javascriptFiles: 0, tsxFiles: 0 };
    const files = ["src/auth/login.ts", "src/auth/validators.ts", "tests/auth/login.test.ts", "src/format/date.ts"];
    const graph = createImportGraph();
    for (const file of files) { graph.imports.set(file, new Set()); graph.importedBy.set(file, new Set()); graph.external.set(file, new Set()); graph.unresolved.set(file, []); }
    graph.imports.set("src/auth/login.ts", new Set(["src/auth/validators.ts"]));
    graph.importedBy.set("src/auth/validators.ts", new Set(["src/auth/login.ts"]));
    const ranked = await rankFiles("fix login validation", repository, graph, files);
    expect(ranked[0]?.path).toBe("src/auth/login.ts");
    expect(ranked.slice(0, 3).map((item) => item.path)).toContain("tests/auth/login.test.ts");
    expect(ranked[0]?.reasons.length).toBeGreaterThan(0);
  });
});
