# CodeAtlas Agent Operations

This document holds command-oriented workflows and operational guidance for coding agents working in this repository.

## Build And Dev Commands

- Install dependencies: `npm install`
- Build everything: `npm run build`
- Build server package: `npm run build:server`
- Build VS Code extension: `npm run extension:build`
- Package VS Code extension: `npm run extension:package`
- Run MCP server from source: `npm run dev`
- Run MCP server for agent verification on Windows: `npm run mcp:agent`
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

Tests use the Node test runner via `tsx`, not Vitest or Jest. Always clean up temp directories in tests using `t.after()` and `rm(dir, { recursive: true, force: true })`.

## Quality Gates

- Formatting and linting use Biome through `npm run format` and `npm run lint`
- TypeScript correctness remains the primary compile-time gate
- For server and core changes, run `npm run build:server`
- For VS Code extension changes, run `npm run extension:typecheck`
- For cross-package changes, run `npm run build` plus relevant tests

## Maintenance Commands

- Windows Zoekt install with fallback: `npm run zoekt:install:windows`
- Windows Zoekt source build: `npm run zoekt:install:windows:source`
- Migrate legacy Zoekt index layout: `npm run zoekt:migrate-index -- --from <dir> --repo <name> --root-path <path> --force-single-repo`
- Functional MCP review: `npm run mcp:functional-review`
- Refresh evaluation workflow: `npm run mcp:refresh-eval`
- Lexical boundary evaluation: `npm run mcp:lexical-boundary-eval`

## Debugging

Debug logging can be enabled via configuration file or environment variable.

### Configuration File

Add a `debug` section to your `codeatlas.json` config:

```json
{
  "debug": {
    "scopes": ["runtime", "mcp", "zoekt"],
    "trace": true
  }
}
```

### Environment Variable

Set `CODEATLAS_DEBUG` with comma-separated scopes:

```bash
CODEATLAS_DEBUG=runtime,mcp,zoekt,trace npm start
```

Environment variables are merged with config settings and take precedence.

### Agent Startup Workflow

When you need a local MCP server specifically for agent-call verification, start it with:

```powershell
npm run mcp:agent
```

This script uses the Windows-native config, enables `runtime,mcp,search-service,ripgrep,zoekt,trace`, and writes to `data/debug/codeatlas.agent.log`.

Recommended verification loop:

1. Run `npm run mcp:agent`
2. Use a real MCP client to call `register_repo`, `find_symbol`, or `code_search`
3. Inspect `data/debug/codeatlas.agent.log` for `codeatlas:mcp` and `codeatlas:search-service` lines

### Minimal Smoke Workflow

Use this when you want a smallest-possible proof that a real MCP client request can hit a local CodeAtlas server process.

1. Run a real MCP stdio client that spawns the local server, registers the repository, and performs one symbol lookup:

```powershell
node --input-type=module -e "import { Client } from '@modelcontextprotocol/sdk/client/index.js'; import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'; const transport = new StdioClientTransport({ command: 'node', args: ['--import','tsx','./packages/mcp-server/src/main.ts'], cwd: process.cwd(), env: { ...process.env, CODEATLAS_CONFIG: 'C:/git/GitHub/LukeLu/CodeAtlas/config/codeatlas.windows.example.json', CODEATLAS_DEBUG: 'runtime,mcp,search-service,ripgrep,zoekt,trace', CODEATLAS_LOG_FILE: 'C:/git/GitHub/LukeLu/CodeAtlas/data/debug/codeatlas.agent.log' } }); const client = new Client({ name: 'manual-smoke-client', version: '1.0.0' }, { capabilities: {} }); await client.connect(transport); await client.callTool({ name: 'register_repo', arguments: { name: 'CodeAtlas', root_path: 'C:/git/GitHub/LukeLu/CodeAtlas', branch: 'main' } }); await client.callTool({ name: 'find_symbol', arguments: { query: 'SearchService', repos: ['CodeAtlas'], kinds: ['class'], exact: true, limit: 5 } }); await transport.close();"
```

2. Inspect the dedicated log file:

```powershell
Get-Content -Path .\data\debug\codeatlas.agent.log -Tail 30
```

Expected signal:

- `codeatlas:runtime` lines confirm the server started
- `codeatlas:mcp` lines confirm the MCP handlers were invoked
- `codeatlas:search-service` lines confirm the request reached the retrieval layer

If you need to keep a separate local server process running for repeated inspection, use `npm run mcp:agent` instead. That workflow is separate from the stdio smoke client above; the inline client command launches its own server process.

### Available Scopes

- `runtime`: Configuration loading and service initialization
- `mcp`: MCP handler invocations and responses
- `indexer`: Index coordination and refresh operations
- `zoekt`: Zoekt backend operations
- `ripgrep`: Ripgrep fallback operations
- `search-service`: Search service orchestration
- `symbol-search`: Symbol search operations
- `symbol-extractor`: Symbol extraction from source files
- `symbol-index`: Symbol index storage operations
- `source-reader`: Source file reading operations
- `registry`: Repository registry operations
- `metadata`: Index metadata operations
- `trace`: Include verbose error streams (stderr/stdout tails)
- `*`: Enable all scopes

## TypeScript Conventions

- Use ESM imports with explicit `.js` suffixes in TypeScript source files
- Group imports in this order: Node built-ins, external packages, local runtime imports
- Use `import type` for type-only imports
- Prefer named exports over default exports
- Keep cross-package imports explicit and relative
- Write strict-mode-safe code without `any`
- Add explicit return types on exported functions and public methods
- Prefer explicit interfaces and discriminated unions for stable contracts
- Keep MCP wire fields in `snake_case` and internal fields in `camelCase`