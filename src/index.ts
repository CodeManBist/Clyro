import "dotenv/config";
import { Command } from "commander";
import { scanRepository } from "./repository/scanner.js";
import { detectProject } from "./repository/project-detector.js";
import { buildImportGraph } from "./repository/import-graph.js";
import { rankFiles } from "./context/ranker.js";
import { PathGuard } from "./security/path-guard.js";
import { createReadOnlyToolRegistry } from "./tools/create-registry.js";
import type { ToolContext } from "./tools/types.js";
import { runPing } from "./cli/commands/ping.js";

const program = new Command();

program.name("clyro").description("A local-first AI coding agent CLI");

program.command("ping").description("Check configured model provider connectivity").action(runPing);

program
  .command("inspect")
  .description("Inspect the current repository")
  .option("--rank <task>", "Rank files relevant to a task")
  .action(async (options: { rank?: string }) => {
    const rootPath = process.cwd();

    // Step 1: Scan repository
    const summary = await scanRepository(rootPath);

    // Step 2: Detect project metadata
    const profile = await detectProject(rootPath, summary);

    console.log("\nRepository summary");
    console.log(`Root: ${summary.rootPath}`);
    console.log(`Files: ${summary.totalFiles}`);
    console.log(`Directories: ${summary.totalDirectories}`);
    console.log(`TypeScript files: ${summary.typescriptFiles}`);
    console.log(`TSX files: ${summary.tsxFiles}`);

    console.log("\nProject profile");
    console.log(`Package manager: ${profile.packageManager}`);
    console.log(`Module type: ${profile.moduleType}`);
    console.log(`Test runner: ${profile.testRunner}`);

    console.log(
      `Scripts: ${Object.keys(profile.scripts).join(", ") || "None"}`,
    );

    console.log(
      `Frameworks: ${profile.frameworks.join(", ") || "None detected"}`,
    );

    console.log(
      `Entry points: ${
        profile.entryPoints.map((entry) => `${entry.path} (${entry.source})`).join(", ") ||
        "None detected"
      }`,
    );

    console.log(`TypeScript config: ${profile.hasTsconfig ? "Yes" : "No"}`);

    console.log(
      `Workspaces: ${profile.workspaces.join(", ") || "None detected"}`,
    );

    if (profile.warnings.length > 0) {
      console.log("\nWarnings:");
      profile.warnings.forEach((warning) => console.log(`- ${warning}`));
    }

    if (options.rank !== undefined) {
      const graph = await buildImportGraph(rootPath, summary.files);
      const ranked = await rankFiles(options.rank, summary, graph, summary.files);
      console.log(`\nRelevant files for: ${options.rank}`);
      for (const file of ranked.slice(0, 10)) {
        console.log(`\n${file.path}  (${file.score.toFixed(2)})`);
        for (const reason of file.reasons) console.log(`  - ${reason}`);
      }
      if (ranked.length === 0) console.log("No relevant source files found.");
    }
  });

program
  .command("tool", { hidden: true })
  .description("Internal read-only developer tools")
  .argument("<name>")
  .argument("<json-args>")
  .action(async (name: string, jsonArgs: string) => {
    const repositoryRoot = process.cwd();
    const controller = new AbortController();
    const context: ToolContext = {
      pathGuard: await PathGuard.create(repositoryRoot),
      repositoryRoot,
      phase: "investigate",
      limits: {
        maxOutputChars: 16_000,
        maxFileBytes: 1_000_000,
        maxReadOutputChars: 8_000,
        maxSearchMatches: 100,
        maxListResults: 200,
        maxDirectoryDepth: 8,
      },
      signal: controller.signal,
      filesRead: new Map(),
    };
    let args: unknown;
    try { args = JSON.parse(jsonArgs); } catch { args = undefined; }
    const result = await createReadOnlyToolRegistry().execute(name, args, context);
    if (result.ok) console.log(result.output);
    else {
      console.log(`error ${result.error.code}: ${result.error.message}`);
      process.exitCode = 1;
    }
  });

const args = process.argv.slice(2);

if (args[0] === "--") {
  args.shift();
}

program
  .parseAsync([
    process.argv[0] ?? "node",
    process.argv[1] ?? "clyro",
    ...args,
  ])
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
