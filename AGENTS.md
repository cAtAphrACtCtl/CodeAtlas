# CodeAtlas Agent Guide

This file is for coding agents working in `C:\git\GitHub\LukeLu\CodeAtlas`.
It replaces and improves the previous root `AGENTS.md`.
It incorporates `.github/copilot-instructions.md`.
No `.cursorrules` file or `.cursor/rules/` directory exists in this repository.

## Repository Snapshot

- CodeAtlas is a local-first code retrieval platform for MCP clients and agent workflows.
- Primary packages: `packages/core`, `packages/mcp-server`, `packages/vscode-extension`.
- Runtime: Node `>=20.11.0`.
- Tooling: TypeScript, `tsx`, Node test runner, npm workspaces, esbuild.
- Module system: ESM with `NodeNext`.

## Core Product Rules

- Keep CodeAtlas local-first: indexing, metadata, retrieval, and source access stay on the local machine.
- Preserve stable MCP tool contracts; prefer additive changes.
- Implemented stable tools: `list_repos`, `register_repo`, `code_search`, `find_symbol`, `read_source`, `get_index_status`, `refresh_repo`.
- Treat `semantic_search` and `hybrid_search` as reserved stable contract surfaces with placeholder implementations.
- Keep Zoekt as the intended primary lexical backend.
- Keep ripgrep as a bootstrap or troubleshooting fallback, not the main design direction.
- Keep refresh repository-scoped: `refresh_repo` must affect only one repository.
- Keep readiness, degraded states, and partial failures explicit.
- Do not document planned features as if they already exist.

## Package Boundaries

- `packages/core` owns configuration, registry, metadata, indexing, retrieval, diagnostics, and shared product logic.
- `packages/mcp-server` owns MCP transport, schemas, handlers, and server bootstrap.
- `packages/vscode-extension` owns VS Code commands and UI integration.
- Dependency flow is STRICTLY one-way: `core` NEVER imports from `mcp-server` or `vscode-extension`.
- Do not put MCP transport logic in `packages/core`.
- Do not put VS Code APIs in `packages/core` or `packages/mcp-server`.
- Do not leak backend-specific process details into MCP contracts.
- Keep backend invocation and normalization inside lexical backend adapters.

## Retrieval Model

- Use `find_symbol` for exact code-entity lookup.
- Use `code_search` for exact token or text lookup.
- Use `read_source` as the grounding step before acting on results.
- Do not treat semantic retrieval as a replacement for lexical or symbol verification.
- Do not depend on `semantic_search` or `hybrid_search` for active behavior today.

## Platform Rules

- Keep Windows and WSL/Linux runtime models consistent.
- Executable paths, repository paths, and index paths must belong to the same runtime environment.
- Do not mix Windows CodeAtlas processes with WSL/Linux Zoekt binaries or vice versa.

## Agent Environment & Tooling Constraints

- Use dedicated Agent Tools (`Glob`, `Grep`, `Read`) for codebase navigation instead of using `Bash` to run `find`, `grep`, or `cat`.
- Do NOT add new third-party dependencies to `package.json` without explicit user approval. CodeAtlas is a strictly local, zero-cloud product.
- Do NOT modify `.vscode/tasks.json` or `.vscode/launch.json` unless explicitly instructed to fix a workspace issue.
- Do NOT edit `AGENTS.md` or `.github/copilot-instructions.md` unless the user asks you to update instructions.
- If asked to test search in an agent sandbox, rely on the ripgrep fallback if Zoekt is not installed in the runtime.
- Never run destructive git commands (like `git reset --hard` or `git push --force`).

## Build And Dev Commands

- Install dependencies: `npm install`
- Build everything: `npm run build`
- Build server package: `npm run build:server`
- Build VS Code extension: `npm run extension:build`
- Package VS Code extension: `npm run extension:package`
- Run MCP server from source: `npm run dev`
- Run built MCP server: `npm start`
- Start MCP server with inspector: `npm run mcp:debug`
- Watch MCP server: `npm run mcp:watch`
- Full-stack watch loop: `npm run dev:fullstack`
- Watch VS Code extension: `npm run extension:watch`
- Typecheck VS Code extension: `npm run extension:typecheck`

## Test Commands

- Run the full suite: `npm test`
- Run one unit test file: `npm exec tsx --test tests/unit/config.test.ts`
- Run one integration test file: `npm exec tsx --test tests/integration/mcp-handlers.test.ts`
- Run any single test file: `npm exec tsx --test <file>`
- Run a named test inside one file: `npm exec tsx --test <file> --test-name-pattern "exact symbol search"`
- Tests use the Node test runner via `tsx`, not Vitest or Jest.
- ALWAYS clean up temp directories in tests using `t.after()` and `rm(dir, { recursive: true, force: true })`.

## Lint And Quality Gates

- There is no dedicated ESLint, Prettier, Biome, or standalone lint script configured.
- Use TypeScript correctness as the enforced quality gate.
- For server and core changes, run `npm run build:server`.
- For VS Code extension changes, run `npm run extension:typecheck`.
- For cross-package changes, run `npm run build` plus relevant tests.

## Useful Maintenance Commands

- Windows Zoekt install with fallback: `npm run zoekt:install:windows`
- Windows Zoekt source build: `npm run zoekt:install:windows:source`
- Migrate legacy Zoekt index layout: `npm run zoekt:migrate-index -- --from <dir> --repo <name> --root-path <path> --force-single-repo`
- Functional MCP review: `npm run mcp:functional-review`
- Refresh evaluation workflow: `npm run mcp:refresh-eval`
- Lexical boundary evaluation: `npm run mcp:lexical-boundary-eval`

## Debugging

- Set `CODEATLAS_DEBUG=*` for broad diagnostics.
- Useful scopes include `runtime`, `mcp`, `indexer`, `zoekt`, `ripgrep`, `search-service`, `symbol-search`, `symbol-extractor`, `source-reader`, `registry`, and `metadata`.
- Add `trace` to include stderr/stdout tails from backend failures, for example `CODEATLAS_DEBUG=zoekt,trace`.

## Import And Module Conventions

- Use ESM imports with explicit `.js` suffixes in TypeScript source files.
- Group imports in this order: Node built-ins, external packages, local runtime imports.
- Separate import groups with a blank line.
- Use `import type` for type-only imports.
- Prefer named exports over default exports.
- Re-export shared public surfaces from package entry files such as `packages/core/src/index.ts`.
- Keep cross-package imports explicit and relative; avoid path alias magic.

## Formatting And Lint Constraints

- The project uses **Biome** (`@biomejs/biome`) to enforce all code style, formatting, and linting rules at compile time.
- Do not guess or search for formatting rules manually. Just run `npm run format` to auto-format the code and `npm run lint` to catch style/lint errors.
- Biome handles indentation, quotes, trailing commas, and semicolons automatically.
- Rely on TypeScript's `strict` mode compiler errors to catch typing and structural issues at compile time.
- To check your work:
  - `npm run format` (auto-formats everything)
  - `npm run lint` (checks for unused variables, missing types, and Biome lint rules)
  - `npm run build:server` or `npm run extension:typecheck` (checks TypeScript types)

## TypeScript Style

- `strict` mode is enabled; write code that passes strict typing without suppressions (`@ts-expect-error` is discouraged).
- Prefer explicit interfaces and discriminated unions for stable contracts.
- Use string-literal unions for statuses and contract enums.
- Use `type` for unions, intersections, and focused aliases.
- Add explicit return types on exported functions and public methods.
- Prefer constructor injection for services and adapters.
- Use `readonly` for class fields and injected dependencies when mutation is not intended.
- Avoid `any`. Use `unknown`, exact interfaces, or local adapter types.

## Naming, Errors, And MCP Rules

- `PascalCase` for classes, interfaces, and exported service types; `camelCase` for functions, methods, variables, and parameters.
- Keep MCP wire fields in `snake_case` when they are part of the public contract, for example `root_path`, `start_line`, and `source_type`.
- Keep internal TypeScript fields in `camelCase`, for example `rootPath`, `startLine`, and `sourceType`.
- Use `CodeAtlasError` for domain and validation errors in core logic.
- Use `invariant(...)` for assertion-style checks that should fail fast with a clear message.
- Throw explicit, actionable errors and preserve partial-failure detail instead of hiding it.
- Validate external inputs at the transport layer with zod schemas.
- Keep handler responses additive and structured; keep transport thin and business logic in shared services.

## Backend, Indexing, And Testing Rules

- Do not build a custom in-house lexical engine when Zoekt already serves that role.
- Keep Zoekt and ripgrep logic isolated inside lexical backend adapters.
- Preserve repository-specific index directories and refresh flows.
- Do not mark a repository fully ready if lexical or symbol indexing failed.
- Keep lexical readiness distinct from symbol readiness.

## Documentation Expectations

- Update `README.md`, `docs/architecture.md`, and `docs/roadmap.md` when behavior, boundaries, workflows, or project status change.
- Keep docs honest about what is implemented versus deferred.

## Before Finishing A Change

- Verify MCP contracts remain stable for `list_repos`, `register_repo`, `code_search`, `find_symbol`, `read_source`, `get_index_status`, `refresh_repo`, `semantic_search`, and `hybrid_search`.
- Verify package boundaries still hold.
- Verify local-first guarantees are preserved.
- Verify Zoekt and ripgrep behavior remains isolated in backend adapters.
- Run the relevant build, typecheck, and test commands for the files you changed.
