# Clyro

Clyro is an early TypeScript/Node.js CLI prototype for an AI coding agent.

## Current status

Clyro is currently a repository-inspection prototype, not yet a complete AI
coding agent.

### Completed

- TypeScript CLI foundation
- Recursive repository scanning
- JavaScript and TypeScript file classification
- Basic package-manager detection
- Basic ESM/CommonJS detection
- Unit tests for scanning and project detection

### Partially completed

- Project metadata detection exists, but most profile fields are placeholders.
- An agent function exists, but it is not connected to the CLI.
- The README examples previously described capabilities that were not yet
  implemented; the actual commands are documented below.

### Not started

- LLM/provider integration
- Interactive coding-agent loop
- File editing
- Shell/tool execution
- Planning, approvals, diffs, rollback, persistence, and packaging

## Current commands

Install dependencies:

```bash
pnpm install
```

Inspect the current repository:

```bash
pnpm dev inspect
```

Build the TypeScript source:

```bash
pnpm build
```

Run the compiled CLI:

```bash
pnpm start inspect
```

Run tests:

```bash
pnpm test
```

Configured scripts are defined in [`package.json`](./package.json):

```text
pnpm dev      Run src/index.ts through tsx
pnpm build    Compile TypeScript into dist/
pnpm start    Run dist/index.js
pnpm test     Run Vitest
```

## Current capabilities

### Repository inspection

[`src/repository/scanner.ts`](./src/repository/scanner.ts) recursively scans a
directory and returns:

- Root path
- Relative file paths
- Relative directory paths
- Total file count
- Total directory count
- TypeScript file count
- JavaScript file count
- TSX file count

The scanner skips common generated or dependency directories:

```text
node_modules
.git
dist
build
.next
coverage
.turbo
.cache
out
```

It supports these source extensions:

```text
TypeScript: .ts, .tsx, .mts, .cts
JavaScript:  .js, .jsx, .mjs, .cjs
```

Symbolic links are not followed, and output is sorted for deterministic
results.

### Basic project detection

[`src/repository/project-detector.ts`](./src/repository/project-detector.ts)
currently detects:

- Package manager from lockfiles:
  - pnpm
  - npm
  - yarn
  - bun
- Package manager from `package.json`'s `packageManager` field
- ESM or CommonJS module type
- Package scripts
- Test runner
- Known frameworks
- Entry points from `main`, `module`, `exports`, `bin`, or common conventions
- Whether `tsconfig.json` exists
- Warnings for conflicting lockfiles or malformed `package.json`

Workspace detection is still a placeholder and currently returns an empty list:

```text
workspaces: []
```

## Architecture

The currently active execution path is:

```text
CLI process
    |
    v
src/index.ts
    |
    +--> Commander parses commands
    |
    +--> inspect command
            |
            v
      scanRepository(process.cwd())
            |
            v
      RepositorySummary
            |
            v
      Console output
```

The project-detection path currently exists separately:

```text
detectProject(rootPath, summary)
    |
    +--> detect package manager
    +--> parse package.json
    +--> determine module type
    +--> return ProjectProfile
```

`detectProject` is tested but is not currently called by the CLI.

[`src/agent.ts`](./src/agent.ts) contains `runAgent(task)`, but it only prints
the received task and an initialization message. It does not call an AI model
or modify files.

[`src/repository/framework-table.ts`](./src/repository/framework-table.ts) is
currently empty.

There is currently no:

- Model provider layer
- Prompt or context builder
- Tool registry
- File-operation layer
- Shell-command layer
- Interactive conversation loop
- Approval system
- Diff or patch system
- Session state
- Git integration

## Repository layout

| Path | Purpose |
|---|---|
| [`src/`](./src/) | TypeScript application source |
| [`src/index.ts`](./src/index.ts) | Commander CLI setup and `inspect` command |
| [`src/agent.ts`](./src/agent.ts) | Placeholder agent function |
| [`src/repository/scanner.ts`](./src/repository/scanner.ts) | Filesystem traversal and source-file classification |
| [`src/repository/project-detector.ts`](./src/repository/project-detector.ts) | Package manager and project metadata detection |
| [`src/repository/framework-table.ts`](./src/repository/framework-table.ts) | Reserved for framework detection rules; currently empty |
| [`tests/`](./tests/) | Vitest tests |
| [`tests/scanner.test.ts`](./tests/scanner.test.ts) | Scanner and additional project-detector tests |
| [`tests/project-detector.test.ts`](./tests/project-detector.test.ts) | Package-manager detection tests |
| [`dist/`](./dist/) | Generated JavaScript output; ignored by Git |
| [`package.json`](./package.json) | Project metadata, scripts, and dependencies |
| [`tsconfig.json`](./tsconfig.json) | Strict TypeScript configuration |
| [`pnpm-lock.yaml`](./pnpm-lock.yaml) | Dependency lockfile |
| [`pnpm-workspace.yaml`](./pnpm-workspace.yaml) | pnpm workspace configuration |

## Tests

The current test suite uses Vitest.

Latest inspected result:

```text
Test Files: 2 passed
Tests:      17 passed
```

### Scanner coverage

[`tests/scanner.test.ts`](./tests/scanner.test.ts) covers:

- TypeScript and TSX discovery
- Recursive file and directory counts
- Ignored directories
- Empty repositories
- Missing-directory errors
- Symbolic-link handling
- JavaScript and TypeScript extension classification
- Package-manager override from `package.json`
- ESM detection
- Missing `package.json`
- Malformed `package.json`

### Project-detector coverage

[`tests/project-detector.test.ts`](./tests/project-detector.test.ts) covers:

- pnpm detection
- npm detection
- yarn detection
- bun detection
- Unknown package manager
- Conflicting lockfiles

Not currently tested:

- CLI command behavior
- `runAgent`
- Framework detection
- Test-runner detection
- Entry-point detection
- Workspace detection
- End-to-end coding-agent flows

## Incomplete or missing functionality

### Project detection gaps

The project profile declares support for test runners, frameworks, entry
points, and workspaces, but these are not implemented yet.

### Agent integration gap

`runAgent` is not imported or called by the CLI. Natural-language examples such
as `pnpm dev -- "Explain this codebase"` do not currently invoke an AI agent.

### Core coding-agent features not implemented

- LLM/API integration
- User conversation loop
- Repository context selection
- Reading files for model context
- Creating or editing files
- Running shell commands
- Running tests automatically
- Applying patches
- Showing diffs
- Requesting user approval
- Conversation history
- Configuration and API-key management
- Git safety checks
- Cross-platform packaging

## Git status

At the time of the repository inspection:

```text
Branch: main
HEAD: d35598f feat: detect project frameworks and tooling
Status: clean
```

The local `main` branch matched `origin/main`:

- No uncommitted changes
- No untracked project files
- No local commits ahead of `origin/main`
- No local commits behind `origin/main`
- No tags

Recent commits:

1. `d35598f` — Detect project frameworks and tooling
2. `cfaea5a` — Classify JavaScript and TypeScript source files
3. `5317643` — Add repository discovery and inspection

Generated `dist/` and `node_modules/` are ignored by
[`.gitignore`](./.gitignore).

## Recommended next step

The next highest-value milestone is to connect a safe, minimal agent loop to
the existing CLI:

1. Add a real `ask` command or default task input.
2. Introduce a model-provider interface.
3. Collect repository context using the existing scanner.
4. Add read-only tools:
   - List files
   - Read files
   - Search files
5. Add structured tool-call handling.
6. Add approval-gated file editing.
7. Add command execution with explicit approval.
8. Add end-to-end CLI tests.

Starting with read-only tools is safer than beginning with unrestricted file
writes or shell execution.

## Roadmap

### Milestone 1 — CLI foundation

**Status: Mostly complete**

- TypeScript project setup
- pnpm scripts
- Commander CLI
- Basic repository inspection
- Strict TypeScript configuration

Remaining:

- Improve help text
- Add CLI integration tests
- Keep README examples aligned with actual commands

### Milestone 2 — Repository intelligence

**Status: Partial**

- Recursive scanner exists
- File classification exists
- Package-manager detection exists

Build next:

- Framework detection
- Test-runner detection
- Entry-point detection
- Workspace detection
- Better project summary output
- Source-file metadata and dependency hints

### Milestone 3 — Model integration

**Status: Not started**

Build:

- Provider abstraction
- API configuration
- Prompt construction
- Streaming responses
- Retry and error handling
- Conversation state

### Milestone 4 — Read-only coding assistance

**Status: Not started**

Build tools for:

- Listing repository files
- Reading files
- Searching code
- Summarizing selected code
- Explaining architecture
- Answering repository questions

### Milestone 5 — Safe code modification

**Status: Not started**

Build:

- File-edit tool
- Patch generation
- Diff display
- Approval prompts
- Atomic writes
- Backup or rollback strategy
- Path-safety checks

### Milestone 6 — Command and test execution

**Status: Not started**

Build:

- Shell-command tool
- User approval for commands
- Test execution
- Build execution
- Captured stdout and stderr
- Timeouts and cancellation

### Milestone 7 — Agent workflow

**Status: Not started**

Build:

- Task planning
- Step-by-step execution
- Tool-call loop
- Failure recovery
- Verification after edits
- Final change summaries

### Milestone 8 — Production readiness

**Status: Not started**

Build:

- Configuration files
- API-key handling
- Cross-platform support
- Packaging and publishing
- Logging
- Documentation
- End-to-end tests
- Security review

## WHERE WE LEFT OFF — NEXT TASK

Clyro has a tested repository scanner and basic project metadata detection, but
no working AI-agent loop.

**Next task:** implement the first real CLI task flow that accepts a user
prompt, invokes a model-provider abstraction, and supports safe read-only
repository tools before adding write capabilities.
