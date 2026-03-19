# CodeAtlas

CodeAtlas is a local-first code retrieval platform for GitHub Copilot and other MCP clients.

Phase 1 is intentionally scoped to lexical retrieval, local repository metadata, and stable MCP tool contracts. The implementation is usable immediately for local repositories while keeping clear seams for future semantic and hybrid retrieval.

## Phase 1 Goals

- Local indexing only
- Local metadata and database only
- Multi-repository support
- One very large repository up to 10GB
- Stable MCP contracts from day one
- Clean upgrade path to hybrid retrieval without rewriting the MCP tool surface

## Current Implementation

The repository now follows a package-oriented architecture:

- `packages/core`: storage, indexing, retrieval, configuration, and discovery services
- `packages/mcp-server`: MCP transport and tool registration
- `packages/vscode-extension`: VS Code command surface for repository discovery and configuration management

Phase 1 remains a TypeScript MCP server with these components:

- Repository registry: local JSON-backed registry of repositories
- Index coordinator: orchestration point for refresh, readiness, and status
- Lexical backend abstraction: phase 1 uses a local ripgrep-backed search path with a naive local fallback
- Source reader: reads source ranges from registered repositories
- Metadata store: local JSON-backed index status store
- MCP transport: stdio server exposing stable tool contracts

The phase 1 lexical implementation does not require any cloud services. All repository metadata, search execution, and source access are local.

## Stable MCP Tools

The public MCP contract is designed to stay stable as retrieval evolves.

Implemented now:

- `list_repos`
- `register_repo`
- `code_search`
- `read_source`
- `get_index_status`
- `refresh_repo`

Reserved from day one with stable contracts:

- `semantic_search`
- `hybrid_search`

The semantic and hybrid tools currently return structured placeholder responses. Their input and output shapes are already defined so future backends can be added without changing the MCP tool names or result schema.

## Search Result Contract

Every search result uses the same structured shape:

```json
{
	"repo": "platform-core",
	"path": "src/search/service.ts",
	"start_line": 42,
	"end_line": 48,
	"snippet": "export class SearchService { ... }",
	"score": 98.2,
	"source_type": "lexical"
}
```

Supported `source_type` values:

- `lexical`
- `semantic`
- `hybrid`

## Project Structure

```text
config/
	codeatlas.example.json
data/
	indexes/
	metadata/
	registry/
docs/
	architecture.md
	roadmap.md
packages/
	core/
		src/
	mcp-server/
		src/
	vscode-extension/
		src/
tests/
	integration/
	unit/
```

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Build

```bash
npm run build
```

### 3. Run the MCP server

```bash
npm start
```

### 4. Run in development mode

```bash
npm run dev
```

### 5. Optional configuration

By default, CodeAtlas uses internal defaults rooted at the repository directory. You can override them with:

- `CODEATLAS_CONFIG=./config/codeatlas.example.json`

## Design Notes

### Why the repository is split into packages

The recommended architecture keeps the public MCP transport thin and pushes product logic into reusable core services. That split allows a future VS Code extension, MCP server, CLI, or batch indexer to share the same repository registry, metadata, and retrieval logic.

### Why the lexical backend is abstracted now

The MCP server depends on the `SearchService` contract, not on a specific lexical engine. Phase 1 can therefore start with ripgrep or another local lexical engine, while future phases can introduce:

- chunk stores
- symbol tables
- local embedding pipelines
- vector indices
- hybrid rank fusion

without changing the MCP tool names or the result envelope.

### How hybrid retrieval fits later

The contract already reserves:

- `semantic_search`
- `hybrid_search`
- `source_type = semantic | hybrid`

The future hybrid design can add semantic candidates and reranking behind the existing `SearchService` and `MetadataStore` seams. The MCP transport layer remains unchanged.

## Tests

The repository includes basic unit and integration scaffolding using the Node test runner:

```bash
npm test
```

## Next Documents

- [docs/architecture.md](docs/architecture.md)
- [docs/roadmap.md](docs/roadmap.md)
- [PROJECT_BOOTSTRAP.md](PROJECT_BOOTSTRAP.md)