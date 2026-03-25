# CodeAtlas Copilot Instructions

CodeAtlas is a local-first, multi-repository code retrieval platform for MCP clients and agent workflows.

## Core expectations

- Keep indexing, metadata, and retrieval local.
- Preserve stable MCP tool contracts.
- Treat implemented tools as stable: `list_repos`, `register_repo`, `code_search`, `find_symbol`, `read_source`, `get_index_status`, and `refresh_repo`.
- Respect package boundaries:
  - `packages/core`: configuration, registry, metadata, indexing, retrieval, shared logic
  - `packages/mcp-server`: MCP transport, tool schemas, handlers, bootstrap
  - `packages/vscode-extension`: VS Code-specific commands and UI integration

## Retrieval model

- `find_symbol` is for exact code entities.
- `code_search` is for exact text or token lookup.
- `read_source` is the grounding step before acting on results.
- `semantic_search` and `hybrid_search` are stable contract surfaces but remain placeholder implementations until semantic and hybrid retrieval are added.

## Backend rules

- Zoekt is the intended primary lexical backend.
- Ripgrep is a bootstrap or development fallback.
- Keep backend-specific invocation and normalization inside lexical backend adapters.
- Do not push backend-specific behavior into MCP handlers or contracts.

## Indexing and status rules

- Keep refresh behavior per-repository.
- Keep lexical and symbol indexing coordinated in the repository refresh lifecycle.
- Make ready, not-indexed, and error states explicit.
- Do not hide partial failures.

## Platform rules

- Keep Windows and WSL/Linux runtime models consistent.
- Executable paths, repository paths, and index paths must belong to the same runtime environment.

## When making changes

- Prefer additive, backward-compatible MCP changes.
- Add or update tests for meaningful behavior changes.
- Update `README.md`, `docs/architecture.md`, and `docs/roadmap.md` when behavior or project status changes.
- Do not document planned features as already implemented.
- Keep partial failures visible; do not report a repository as fully ready when lexical or symbol indexing failed.
