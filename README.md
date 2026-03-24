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
	"lexicalBackend": {
		"kind": "zoekt",
		"zoektIndexExecutable": "../.tools/zoekt/bin/zoekt-index.exe",
		"zoektSearchExecutable": "../.tools/zoekt/bin/zoekt.exe",
		"indexRoot": "../data/indexes/zoekt"
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
	"lexicalBackend": {
		"kind": "zoekt",
		"zoektIndexExecutable": "../.tools/zoekt/linux-bin/zoekt-index",
		"zoektSearchExecutable": "../.tools/zoekt/linux-bin/zoekt",
		"indexRoot": "../data/indexes/zoekt-wsl"
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