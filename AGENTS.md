# CodeAtlas Agent Guide

This file is for coding agents working in `C:\git\GitHub\LukeLu\CodeAtlas`.
It replaces and improves the previous root `AGENTS.md`.
It incorporates `.github/copilot-instructions.md`.
No `.cursorrules` file or `.cursor/rules/` directory exists in this repository.

Operational workflows, command catalogs, and debug procedures live in `docs/agent-operations.md`.

## Repository Snapshot

- CodeAtlas is a local-first code retrieval platform for MCP clients and agent workflows.
- Primary packages: `packages/core`, `packages/mcp-server`, `packages/vscode-extension`.
- Runtime: Node `>=20.11.0`.
- Tooling: TypeScript, `tsx`, Node test runner, npm workspaces, esbuild.
- Module system: ESM with `NodeNext`.
- Detailed command and debugging workflows: `docs/agent-operations.md`

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

## Agent Verification Workflow

- Prefer `npm run mcp:agent` when you need to prove a real MCP client request hit the local server
- Inspect `data/debug/codeatlas.agent.log` for `codeatlas:mcp` and `codeatlas:search-service` lines after the client call
- Use the broader command catalog and debug details in `docs/agent-operations.md`

## TypeScript Style

- `strict` mode is enabled; write code that passes strict typing without suppressions (`@ts-expect-error` is discouraged).
- Prefer explicit interfaces and discriminated unions for stable contracts.
- Use string-literal unions for statuses and contract enums.
- Use `type` for unions, intersections, and focused aliases.
- Add explicit return types on exported functions and public methods.
- Prefer constructor injection for services and adapters.
- Use `readonly` for class fields and injected dependencies when mutation is not intended.
- Avoid `any`. Use `unknown`, exact interfaces, or local adapter types.
- See `docs/agent-operations.md` for the operational lint, format, and validation commands.

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
