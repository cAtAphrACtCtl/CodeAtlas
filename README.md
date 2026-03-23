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

CodeAtlas now includes a first slice of Phase 2 symbol-aware retrieval on top of the phase 1 lexical foundation.

Current components:

- Repository registry: local JSON-backed registry of repositories
- Index coordinator: orchestration point for refresh, readiness, and status
- Lexical backend abstraction: target production path is Zoekt-backed indexing, while the current repository still includes a local ripgrep-backed bootstrap path for development
- Symbol extraction pipeline: local TypeScript-powered extraction for TS and JS repositories
- Symbol index store: local JSON-backed symbol metadata per repository
- Symbol search backend: local symbol lookup with exact, prefix, and substring matching
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
- `find_symbol`
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
- `symbol`
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

### 5. Develop the VS Code extension

Build once:

```bash
npm run extension:build
```

Run continuous watch mode:

```bash
npm run extension:watch
```

Run the full-stack watch loop from the terminal:

```bash
npm run dev:fullstack
```

In VS Code, use the `Run CodeAtlas Extension` launch configuration for extension-only work, `CodeAtlas Dev: Extension + MCP` for one-shot debugging, or `CodeAtlas Dev: Full Stack Watch` for a watch-based inner loop.

### 6. Optional configuration

By default, CodeAtlas uses internal defaults rooted at the repository directory. You can override them with:

- `CODEATLAS_CONFIG=./config/codeatlas.example.json`

## Design Notes

### Why the repository is split into packages

The recommended architecture keeps the public MCP transport thin and pushes product logic into reusable core services. That split allows a future VS Code extension, MCP server, CLI, or batch indexer to share the same repository registry, metadata, and retrieval logic.

### Why the lexical backend is abstracted now

The MCP server depends on the `SearchService` contract, not on a specific lexical engine. CodeAtlas can therefore move from the bootstrap ripgrep path to a Zoekt-backed production lexical backend without changing the MCP tool names or the result envelope, while future phases can still introduce:

- chunk stores
- symbol tables
- local embedding pipelines
- vector indices
- hybrid rank fusion

without changing the MCP tool names or the result envelope.

### Zoekt backend integration

The intended lexical direction is:

- `refresh_repo` builds or refreshes a Zoekt index for one repository
- `code_search` queries the Zoekt-backed lexical index
- metadata remains owned by CodeAtlas even when the lexical index files are produced by Zoekt tooling
- the existing ripgrep path remains only as a bootstrap and development fallback mode

The expected backend behavior is:

- production mode: Zoekt is the primary lexical engine
- development fallback mode: if Zoekt is not configured or not available, the bootstrap ripgrep path can still serve local development
- semantic and hybrid retrieval continue to depend on the same stable MCP contracts regardless of which lexical backend is active

### How hybrid retrieval fits later

The contract already reserves:

- `semantic_search`
- `hybrid_search`
- `source_type = semantic | hybrid`

The future hybrid design can add semantic candidates and reranking behind the existing `SearchService` and `MetadataStore` seams. The MCP transport layer remains unchanged.

### What phase 2 adds now

The current symbol-aware slice indexes top-level and nested TypeScript and JavaScript declarations locally during repository refresh. That enables symbol-oriented lookup through the new `find_symbol` MCP tool without changing the existing lexical result shape or the reserved semantic and hybrid contracts.

### Agent retrieval policy

For agent-style retrieval, CodeAtlas treats symbol, lexical, and semantic search as complementary layers.

- when an agent already knows an exact symbol name, it should prefer `find_symbol` first, then use `read_source` to verify the code
- when an agent knows an exact text token that is not necessarily a symbol, it should prefer lexical retrieval through `code_search`
- when an agent only has a vague natural-language intent, it should use `semantic_search` as a recall layer once implemented, then verify candidates through symbol or lexical retrieval before acting on them

This means semantic retrieval is intended to expand recall, while symbol and lexical retrieval remain the precision layers used to ground agent behavior.

## Tests

The repository includes basic unit and integration scaffolding using the Node test runner:

```bash
npm test
```

## Debugging

For a smooth local development loop in VS Code:

- `Run CodeAtlas Extension` starts the extension host and keeps the extension bundle in watch mode
- `Debug CodeAtlas MCP` starts the MCP server from source with `tsx`
- `CodeAtlas Dev: Extension + MCP` launches both together
- `Attach CodeAtlas MCP Watch` attaches the debugger to a watched MCP server on port `9230`
- `CodeAtlas Dev: Full Stack Watch` keeps the extension bundle and MCP server in watch mode while attaching debuggers where possible

Available development tasks:

- `codeatlas: build server`
- `codeatlas: build extension`
- `codeatlas: watch extension`
- `codeatlas: watch mcp`
- `codeatlas: full-stack watch`

The workspace also recommends the `connor4312.esbuild-problem-matchers` extension so esbuild watch errors surface cleanly in the Problems panel.

## Next Documents

- [docs/architecture.md](docs/architecture.md)
- [docs/roadmap.md](docs/roadmap.md)
- [PROJECT_BOOTSTRAP.md](PROJECT_BOOTSTRAP.md)