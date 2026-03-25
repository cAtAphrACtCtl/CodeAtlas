# CodeAtlas

CodeAtlas is a local-first code retrieval platform for GitHub Copilot and other MCP clients.

The current project focus is Zoekt-backed lexical retrieval, repository-scoped indexing, and reliable refresh behavior after repository updates. `find_symbol` is available today but is backed by an experimental TypeScript and JavaScript-specific symbol index. `semantic_search` and `hybrid_search` remain reserved placeholder contracts rather than active implementation work. See [docs/roadmap.md](docs/roadmap.md) for detailed phase status.

## Design Constraints

- Local indexing only
- Local metadata and database only
- Multi-repository support
- One very large repository up to 10GB
- Stable MCP contracts from day one
- Clean upgrade path to hybrid retrieval without rewriting the MCP tool surface

## Current Implementation

The repository follows a package-oriented architecture:

- `packages/core`: configuration, registry, metadata, indexing, retrieval, and shared product logic
- `packages/mcp-server`: MCP transport, tool schemas, handlers, and server bootstrap
- `packages/vscode-extension`: VS Code command surface for repository discovery and configuration management

Current components:

- Repository registry: local JSON-backed registry of repositories
- Index coordinator: orchestration point for repository-scoped refresh, readiness, and status
- Lexical backend abstraction: Zoekt is the current primary backend; a ripgrep-backed bootstrap path remains available as a development or troubleshooting fallback
- Symbol extraction pipeline: experimental TypeScript-powered extraction for TS and JS repositories
- Symbol index store: local JSON-backed symbol metadata for the current experimental `find_symbol` path
- Symbol search backend: targeted exact, prefix, and substring symbol lookup for the current experimental symbol path
- Source reader: reads source ranges from registered repositories
- Metadata store: local JSON-backed index status store with `not_indexed`, `indexing`, `ready`, `stale`, and `error` states
- MCP transport: stdio server exposing stable tool contracts

All repository metadata, search execution, and source access are local. No cloud services are required.

## Current Development Focus

- validate Zoekt indexing correctness and repeated refresh after repository updates
- measure large-repository indexing and query behavior with Zoekt as the primary backend
- keep custom symbol extraction under evaluation instead of expanding its scope immediately
- defer semantic and hybrid implementation work until Zoekt-first workflows are proven

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

`find_symbol` is implemented, but its current TS and JS-specific backing index is still under evaluation.

Reserved with stable contracts (placeholder implementations):

- `semantic_search`
- `hybrid_search`

These tools return structured placeholder responses today. Their input and output shapes are already defined so future backends can be added without changing the MCP tool names or result schema.

## Search Result Contract

The `code_search`, `semantic_search`, and `hybrid_search` contracts share the same structured search result shape:

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

`find_symbol` is a separate MCP tool with its own symbol-oriented response shape.

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

Platform-specific examples are also available:

- Windows native Zoekt: `./config/codeatlas.windows.example.json`
- WSL/Linux Zoekt: `./config/codeatlas.wsl.example.json`

### 7. Install Zoekt On Windows

For a repo-local Windows installation of Zoekt, use:

```powershell
npm run zoekt:install:windows
```

This is now the recommended default path on Windows. It first tries the upstream `go install` flow and automatically falls back to the patched source-build flow if upstream Windows builds fail.

If the upstream `go install` path does not produce working Windows binaries, use the source-build path instead:

```powershell
npm run zoekt:install:windows:source
```

The installer script:

- installs `zoekt.exe` and `zoekt-index.exe` into `.tools/zoekt/bin`
- requires `go` to be available, or can optionally try `winget` if you pass `-InstallGoWithWinget` directly to the script
- prints a ready-to-use config snippet pointing CodeAtlas at the installed binaries
- the default npm entry now enables `-FallbackToSourceBuild`, so the standard Windows install command prefers the more resilient path
- supports `-UseSourceBuild` for an explicit source-build path and `-FallbackToSourceBuild` to retry with a patched source build if `go install` fails

The source-build path:

- clones Zoekt source into a temporary directory
- applies a minimal Windows compatibility patch for the missing `IndexFile` and `umask` implementations
- builds `zoekt.exe` and `zoekt-index.exe` into the same `.tools/zoekt/bin` directory
- uses your existing Go module environment by default instead of forcing a specific proxy configuration

Proxy recommendation:

- default behavior is to let Go use its normal module settings from your shell or machine configuration
- if your network cannot reach the default Go module endpoints, pass `-GoProxy` and optionally `-GoSumDb` explicitly
- for example, some environments may prefer `-GoProxy https://goproxy.cn,direct -GoSumDb sum.golang.google.cn`

Example direct invocation:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-zoekt-windows.ps1 -FallbackToSourceBuild -AddUserPath
```

Example with an explicit Go proxy override:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-zoekt-windows.ps1 -FallbackToSourceBuild -GoProxy https://goproxy.cn,direct -GoSumDb sum.golang.google.cn
```

Explicit source build:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-zoekt-windows.ps1 -UseSourceBuild -AddUserPath
```

Automatic fallback to source build if `go install` fails:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-zoekt-windows.ps1 -FallbackToSourceBuild -AddUserPath
```

### 8. Windows And WSL Example Configs

Windows-native example:

```json
{
	"indexRoot": "../data/indexes",
	"lexicalBackend": {
		"kind": "zoekt",
		"zoektIndexExecutable": "../.tools/zoekt/bin/zoekt-index.exe",
		"zoektSearchExecutable": "../.tools/zoekt/bin/zoekt.exe"
	}
}
```

Full file: [config/codeatlas.windows.example.json](config/codeatlas.windows.example.json)

Use the Windows example when:

- CodeAtlas itself is running on Windows
- registered repository paths are Windows paths such as `C:\repo\project`
- you want the standard install flow to work with the source-build fallback we added

Why:

- the current Zoekt backend launches executables directly with `execFile`, so Windows processes and Windows repository paths work naturally with Windows `zoekt.exe`
- this keeps path handling simple because index build and search both stay in the same OS runtime as the MCP server
- this is now the recommended default on Windows because the installer can recover from upstream Windows build failures by falling back to a patched source build

WSL/Linux example:

```json
{
	"indexRoot": "../data/indexes",
	"lexicalBackend": {
		"kind": "zoekt",
		"zoektIndexExecutable": "../.tools/zoekt/linux-bin/zoekt-index",
		"zoektSearchExecutable": "../.tools/zoekt/linux-bin/zoekt"
	}
}
```

Full file: [config/codeatlas.wsl.example.json](config/codeatlas.wsl.example.json)

Use the WSL example when:

- CodeAtlas is running inside WSL, not from a Windows Node process
- registered repository paths are Linux paths such as `/home/user/repo` or `/mnt/c/...`
- you want to use native Linux Zoekt binaries without relying on the Windows compatibility patch

Why:

- Linux Zoekt is the upstream-native path and avoids the Windows-specific source patch entirely
- if the MCP server process runs inside WSL, the executable paths, repository paths, and index paths all share one filesystem model
- this is the cleaner option if your main development shell and repository workflow already live in WSL

Do not mix the two models in one process:

- do not run CodeAtlas on Windows while pointing it at WSL/Linux Zoekt binaries
- do not register Windows-style repository paths while CodeAtlas is running inside WSL with Linux Zoekt

Reason:

- the current backend passes `repository.rootPath` directly to Zoekt commands and does not translate paths between Windows and WSL automatically
- the executable and the repository path therefore need to belong to the same runtime environment

### 9. Index Root Configuration

CodeAtlas uses a single `indexRoot` setting to determine where all index artifacts live. The Zoekt index directory is derived automatically:

```
${indexRoot}/zoekt/
```

You no longer need to set `lexicalBackend.indexRoot` in most configurations. The priority chain is:

1. Explicit `lexicalBackend.indexRoot` (advanced override)
2. Derived from top-level `indexRoot` as `${indexRoot}/zoekt`
3. Built-in default: `data/indexes/zoekt`

Inside the Zoekt index directory, each repository gets its own subdirectory:

```
${indexRoot}/zoekt/repos/<slug>-<hash>/
```

The slug is a sanitized version of the repository name, and the hash is an 8-character SHA-256 of the repository's root path. This ensures multi-repository isolation without collisions.

### 10. Migrating From Shared Zoekt Index Layout

If you have an existing Zoekt index from before per-repository isolation was added, use the migration script only when you have verified that the old flat Zoekt root contains shards for exactly one repository:

```bash
npm run zoekt:migrate-index -- --from ./data/indexes/zoekt --repo my-repo --root-path /path/to/my-repo --force-single-repo
```

Options:

- `--from` (required): the old shared Zoekt index directory containing `.zoekt` files
- `--repo` (required): the repository name as registered in CodeAtlas
- `--root-path` (required): the repository root path used during registration
- `--dry-run` (optional): preview what would be moved without making changes
- `--force-single-repo` (required for actual moves): confirms that every loose shard file in the old flat directory belongs to the single repository you passed on the command line

If the old flat directory contains shards from multiple repositories, do not migrate it in place. Delete the old flat shards and re-run `refresh_repo` for each repository to rebuild them into isolated per-repo directories.

If migration fails, delete the old index directory and re-run `refresh_repo` to rebuild from scratch.

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

The current lexical backend integration is:

- `refresh_repo` builds or refreshes a Zoekt index for one repository
- `code_search` queries the Zoekt-backed lexical index
- metadata remains owned by CodeAtlas even when the lexical index files are produced by Zoekt tooling
- the ripgrep path remains as a bootstrap and development fallback mode

Backend behavior:

- production mode: Zoekt is the primary lexical engine
- development fallback mode: if Zoekt is not configured or not available, the ripgrep path can still serve local development
- semantic and hybrid retrieval depend on the same stable MCP contracts regardless of which lexical backend is active

Current validation focus:

- confirm lexical results stay correct after repository updates and repeated refreshes
- measure indexing and query behavior on representative large repositories
- improve readiness, fallback, and error diagnostics before expanding the retrieval surface
- keep lexical readiness usable even when symbol freshness or symbol extraction fails

### How hybrid retrieval fits later

The contract already reserves:

- `semantic_search`
- `hybrid_search`
- `source_type = semantic | hybrid`

The future hybrid design can add semantic candidates and reranking behind the existing `SearchService` and `MetadataStore` seams. The MCP transport layer remains unchanged.

### Experimental symbol lookup

The current symbol-aware slice indexes top-level and nested TypeScript and JavaScript declarations locally during repository refresh. This enables a dedicated `find_symbol` MCP tool without changing the existing lexical result shape or the reserved semantic and hybrid contracts. The feature remains under evaluation and will be compared against Zoekt-first lexical workflows before any broader custom symbol indexing scope or deeper symbol work is considered.

### Agent retrieval policy

For agent-style retrieval today, CodeAtlas treats Zoekt-backed lexical search as the primary retrieval path.

- when an agent knows an exact text token that is not necessarily a symbol, it should prefer lexical retrieval through `code_search`
- when an agent knows an exact TypeScript or JavaScript symbol name and wants a definition-oriented lookup, it can use `find_symbol` and then `read_source`
- agents should not depend on `semantic_search` or `hybrid_search` today because those tools are still placeholder implementations

Today the recommended grounding path is Zoekt-backed lexical search plus `read_source`; symbol lookup is optional and still under evaluation.

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
- [docs/zoekt-first-todo.md](docs/zoekt-first-todo.md)
