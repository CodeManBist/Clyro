import path from "node:path";
import { scanRepository } from "../src/repository/scanner.js";
import { buildImportGraph } from "../src/repository/import-graph.js";
import { rankFiles } from "../src/context/ranker.js";

const root = path.resolve("fixtures/graph-app");
const cases = [
  { task: "create user", expected: ["src/auth/user.ts"] },
  { task: "validate email", expected: ["src/auth/validators.ts", "src/auth/user.ts"] },
  { task: "format date", expected: ["src/shared/date.ts", "src/index.ts"] },
  { task: "fix user test", expected: ["tests/user.test.ts", "src/auth/user.ts"] },
  { task: "validate password", expected: ["src/auth/validators.ts"] },
  { task: "application startup express", expected: ["src/index.ts", "src/auth/user.ts", "src/shared/date.ts"] },
];
const summary = await scanRepository(root);
const graph = await buildImportGraph(root, summary.files);
let recall5 = 0; let recall10 = 0;
for (const item of cases) {
  const ranked = await rankFiles(item.task, summary, graph, summary.files);
  const hit = (limit: number) => item.expected.filter((file) => ranked.slice(0, limit).some((row) => row.path === file)).length / item.expected.length;
  recall5 += hit(5); recall10 += hit(10);
  console.log(`${item.task}: ${ranked.slice(0, 5).map((row) => `${row.path} (${row.score})`).join(", ")} | relevant=${item.expected.join(", ")} | R@5=${hit(5).toFixed(3)} R@10=${hit(10).toFixed(3)}`);
}
console.log(`Macro-average recall@5=${(recall5 / cases.length).toFixed(3)} recall@10=${(recall10 / cases.length).toFixed(3)}`);
