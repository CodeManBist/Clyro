import { Command } from "commander";
import { scanRepository } from "./repository/scanner.js";

const program = new Command();

program.name("clyro").description("A local-first AI coding agent CLI");

program
  .command("inspect")
  .description("Inspect the current repository")
  .action(async () => {
    const summary = await scanRepository(process.cwd());

    console.log("Repository summary");
    console.log(`Root: ${summary.rootPath}`);
    console.log(`Files: ${summary.totalFiles}`);
    console.log(`Directories: ${summary.totalDirectories}`);
    console.log(`TypeScript files: ${summary.typescriptFiles}`);
    console.log(`TSX files: ${summary.tsxFiles}`);
  });

const args = process.argv.slice(2);
if (args[0] === "--") {
  args.shift();
}

program
  .parseAsync([process.argv[0] ?? "node", process.argv[1] ?? "clyro", ...args])
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
