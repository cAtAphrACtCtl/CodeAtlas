# CodeAtlas Architecture

## Objectives

CodeAtlas is designed as a local-first retrieval system for codebases used by GitHub Copilot through MCP.

The architecture is constrained by:

- local indexing only
- local metadata and database only
- multi-repository operation
- one very large repository up to 10GB
- a phase 1 lexical implementation that does not lock out future hybrid retrieval

## Architectural Boundaries

The core design rule is strict separation of concerns.

### Storage concerns

Handled by:

- repository registry persistence
- metadata store persistence
- future chunk store persistence
- future vector index persistence

These layers own how data is stored locally, not how it is searched or exposed through MCP.

### Indexing concerns

Handled by:

- index coordinator
- lexical backend preparation
- future chunking pipelines
- future embedding pipelines
- future symbol extraction

This layer decides when and how artifacts are built or refreshed.

### Retrieval concerns

Handled by:

- search service
- lexical backend abstraction
- future semantic backend abstraction
- future rank fusion and reranking

This layer is responsible for result generation and ranking, not file transport or metadata persistence.

### MCP transport concerns

Handled by:

- tool schemas
- tool handlers
- stdio server bootstrap

This layer maps stable external contracts to internal services. It should remain stable as internals evolve.

## Phase 1 Components

## Package Layout

The repository is split into three top-level packages.

### `packages/core`

Owns product logic and local persistence abstractions.

Includes:

- configuration loading and management
- repository discovery
- repository registry
- metadata store
- source reader
- lexical search backend abstraction
- index coordination
- search services

### `packages/mcp-server`

Owns MCP transport only.

Includes:

- tool schemas
- tool handlers
- MCP server registration
- stdio bootstrap

### `packages/vscode-extension`

Owns VS Code-specific command and UI integration.

Includes:

- command palette actions for repository discovery and registration
- config file entry points
- repository status display helpers

### Repository Registry

Tracks locally registered repositories.

Responsibilities:

- register repositories by logical name and local path
- list configured repositories
- resolve repositories during search and source reads

Storage:

- local JSON today
- local SQLite later if registry query complexity grows

### Metadata Store

Tracks index status and backend readiness information.

Responsibilities:

- store repository index state
- record last refresh times
- track backend-specific metadata without leaking it into MCP contracts

Storage:

- local JSON today
- local SQLite later for richer operational metadata

### Index Coordinator

Coordinates refresh and readiness across repositories.

Responsibilities:

- prepare or refresh lexical search backend state
- update metadata store status
- isolate per-repository refresh from other repositories

This design matters for the 10GB repository requirement because large repositories must be refreshable independently.

### Lexical Search Backend Abstraction

Phase 1 uses a `LexicalSearchBackend` interface. The initial implementation is local ripgrep execution with a naive filesystem fallback.

Responsibilities:

- return lexical matches for a repository
- remain independent from MCP transport
- permit backend replacement with Zoekt or another local engine later

Why this matters:

- ripgrep gets phase 1 usable quickly
- a dedicated local indexer such as Zoekt can be introduced later behind the same abstraction
- the `SearchService` and MCP tools do not change

### Source Reader

Reads requested source ranges from registered repositories.

Responsibilities:

- path normalization
- line-range reads
- traversal protection

### MCP Server

Exposes stable tool contracts:

- `list_repos`
- `register_repo`
- `code_search`
- `semantic_search`
- `hybrid_search`
- `read_source`
- `get_index_status`
- `refresh_repo`

The `semantic_search` and `hybrid_search` tools exist now as placeholders so future retrieval upgrades do not require contract renames or transport changes.

### VS Code Extension

The extension is intentionally separate from MCP transport.

Responsibilities:

- discover repositories from workspace-adjacent folders
- register repositories through shared core services
- display local repository and index status through VS Code commands
- open and manage CodeAtlas configuration from the command palette

This avoids mixing VS Code APIs into the MCP server package.

## Result Contract

All retrieval paths converge on the same result shape:

```json
{
  "repo": "repo-name",
  "path": "src/file.ts",
  "start_line": 10,
  "end_line": 14,
  "snippet": "matched content",
  "score": 92.5,
  "source_type": "lexical"
}
```

`source_type` is future-safe and already supports:

- `lexical`
- `semantic`
- `hybrid`

## Upgrade Path To Hybrid Retrieval

The design explicitly preserves the MCP boundary while allowing deeper internals later.

### Phase 2: symbol-aware retrieval

Add a symbol extraction pipeline and symbol index behind retrieval services.

Impact:

- new internal services only
- MCP tool contracts unchanged

### Phase 3: chunk-based indexing and local embeddings

Add chunk storage and a local embedding pipeline.

Impact:

- metadata store may track chunk and embedding versions
- semantic backend is introduced behind `semantic_search`
- source result contract unchanged

### Phase 4: vector search and hybrid ranking

Add vector retrieval and hybrid candidate merging.

Impact:

- `hybrid_search` becomes fully implemented
- `SearchService` composes lexical and semantic candidates
- MCP handlers still return the same shape

## Large Repository Considerations

For the up-to-10GB repository target, the architecture assumes:

- repository-local refresh operations
- no requirement to rebuild all repositories together
- independent metadata and index state per repository
- search backends that can avoid whole-workspace scans when upgraded to stronger local engines

Phase 1 is intentionally conservative. It gets the public architecture right first so performance-specific backend swaps do not force transport redesign.