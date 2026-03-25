# CodeAtlas Agent Rules

## Must Do

- Keep CodeAtlas local-first: indexing, metadata, and retrieval stay on the local machine.
- Preserve stable MCP tool contracts. Do not casually rename tools or break request/response shapes.
- Respect package boundaries:
  - `packages/core` owns configuration, registry, metadata, indexing, retrieval, and shared product logic.
  - `packages/mcp-server` owns MCP transport, tool schemas, handlers, and server bootstrap.
  - `packages/vscode-extension` owns VS Code-specific commands and UI integration.
- Keep retrieval layers distinct and composable:
  - use `find_symbol` for exact code entities
  - use `code_search` for exact text or token lookup
  - use `read_source` as the grounding step
  - treat `semantic_search` and `hybrid_search` as contract-stable future surfaces
- Keep Zoekt as the intended primary lexical backend and ripgrep as bootstrap or development fallback.
- Keep per-repository refresh behavior. `refresh_repo` should affect one repository without rebuilding unrelated repositories.
- Make readiness and failure states explicit in metadata and user-visible results.
- Add or update tests for meaningful behavior changes at the correct layer.
- Update `README.md`, `docs/architecture.md`, and `docs/roadmap.md` when behavior, boundaries, or project status changes.

## Never Do

- Do not build a custom in-house lexical indexing engine inside CodeAtlas when Zoekt already fills that role.
- Do not put MCP transport logic into `packages/core`.
- Do not put VS Code APIs into `packages/core` or `packages/mcp-server`.
- Do not leak backend-specific process details into MCP contracts.
- Do not treat semantic retrieval as a replacement for lexical or symbol verification.
- Do not mix Windows and WSL runtime models carelessly; executable paths, repository paths, and index paths must belong to the same runtime environment.
- Do not document planned features as if they are already implemented.
- Do not add breaking MCP contract changes when an additive change will work.
- Do not hide partial failures; if lexical or symbol indexing fails, report it clearly.

## Before Finishing A Change

- Verify MCP contracts remain stable for `list_repos`, `register_repo`, `code_search`, `find_symbol`, `read_source`, `get_index_status`, `refresh_repo`, and the reserved `semantic_search` and `hybrid_search` surfaces.
- Verify package boundaries are still respected.
- Verify Zoekt and ripgrep logic stays isolated inside lexical backend adapters rather than transport handlers.
- Verify refresh and readiness behavior remains repository-scoped.
- Verify local-first guarantees are preserved.
- Verify tests cover the changed behavior:
  - unit tests for core indexing, search, ranking, configuration, and backend selection
  - integration tests for MCP request/response behavior
  - placeholder contract tests for `semantic_search` and `hybrid_search` when relevant
- Verify docs match the new implementation and current project status.
