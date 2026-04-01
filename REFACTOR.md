# CodeAtlas Refactor Plan

## Goals

1. **Flat src/ layout** — move code from `packages/X/src/` to `src/X/`, making it read like application source, not a dependency tree.
2. **Central config** — one `config/codeatlas.json` used by all tools (git-ignored), with example files alongside it.
3. **CLI entry point** — a human-usable `src/cli/main.ts` for direct interaction and debugging without needing an MCP client.

---

## Phase 1 — Directory Restructure: `packages/X/src/` → `src/X/`

### 1a. File moves (`git mv`)

| From | To |
|------|-----|
| `packages/core/src/**` | `src/core/**` |
| `packages/mcp-server/src/**` | `src/mcp-server/**` |
| `packages/vscode-extension/src/**` | `src/vscode-extension/**` |
| `packages/vscode-extension/esbuild.mjs` | `src/vscode-extension/esbuild.mjs` |
| `packages/vscode-extension/tsconfig.json` | `src/vscode-extension/tsconfig.json` |
| `packages/vscode-extension/package.json` | `src/vscode-extension/package.json` |

**Delete:**
- `packages/core/package.json` (merged to root)
- `packages/mcp-server/package.json` (merged to root)
- `packages/core/` directory (now empty)
- `packages/mcp-server/` directory (now empty)
- Root-level legacy `src/common/`, `src/contracts/`, `src/indexer/`, `src/mcp/`, `src/metadata/`, `src/reader/`, `src/registry/`, `src/search/` (all empty)

### 1b. Import path updates

#### `src/mcp-server/main.ts` (2 imports)
- `../../core/src/logging/logger.js` → `../core/logging/logger.js`
- `../../core/src/runtime.js` → `../core/runtime.js`

#### `src/mcp-server/mcp/handlers.ts` (12 imports)
- `../../../core/src/X.js` → `../../core/X.js`

#### `src/mcp-server/mcp/server.ts` (1 import)
- `../../../core/src/configuration/config.js` → `../../core/configuration/config.js`

#### `src/vscode-extension/commands/register-commands.ts` (1 import)
- `../../../core/src/runtime.js` → `../../core/runtime.js`

#### `src/vscode-extension/providers/repository-picker.ts` (3 imports)
- `../../../core/src/X.js` → `../../core/X.js`

#### `tests/integration/mcp-handlers.test.ts` (11 imports)
- `../../packages/core/src/X.js` → `../../src/core/X.js`
- `../../packages/mcp-server/src/mcp/handlers.js` → `../../src/mcp-server/mcp/handlers.js`

#### `tests/unit/*.test.ts` (all unit test files, ~15 imports total)
- `../../packages/core/src/X.js` → `../../src/core/X.js`

### 1c. Config / tooling file updates

| File | Change |
|------|--------|
| `tsconfig.json` | `include`: `packages/core/src/**` → `src/core/**`; `packages/mcp-server/src/**` → `src/mcp-server/**` |
| `package.json` | `workspaces`: `["packages/*"]` → `["src/vscode-extension"]` |
| `package.json` | `main`: `dist/packages/mcp-server/src/main.js` → `dist/src/mcp-server/main.js` |
| `package.json` | All scripts referencing `packages/mcp-server/src/main.ts` → `src/mcp-server/main.ts` |
| `.vscode/tasks.json` | `./packages/mcp-server/src/main.ts` → `./src/mcp-server/main.ts` (line 56) |
| `.vscode/tasks.json` | `fileLocation` for watch bundle task: `packages/vscode-extension` → `src/vscode-extension` |
| `.vscode/launch.json` | No `packages/` path references (already attach-only, no hardcoded paths) |
| `.vscode/mcp.json` | `packages/mcp-server/src/main.ts` → `src/mcp-server/main.ts` |
| `opencode.json` | `packages/mcp-server/src/main.ts` → `src/mcp-server/main.ts` |
| `src/vscode-extension/esbuild.mjs` | `entryPoints: ["src/extension.ts"]` stays valid (relative to its new location) |
| `src/vscode-extension/tsconfig.json` | `include: ["../core/src/**/*.ts"]` → `["../core/**/*.ts"]`; `src/**/*.ts` stays valid |
| `scripts/mcp-agent.ps1` | `packages/mcp-server/src/main.ts` → `src/mcp-server/main.ts` |
| `scripts/mcp-dev.sh` | same |
| `scripts/mcp-dev.ps1` | same |
| `scripts/mcp-functional-review.mjs` | same |
| `scripts/mcp-refresh-eval.mjs` | same |
| `scripts/mcp-lexical-boundary-eval.mjs` | same |

---

## Phase 2 — Central Config: `config/codeatlas.json`

### Changes

| # | Action | File |
|---|--------|------|
| 1 | `git mv config/codeatlas.dev.json config/codeatlas.json` | — |
| 2 | Add `config/codeatlas.json` to `.gitignore` | `.gitignore` |
| 3 | Update `CODEATLAS_CONFIG` env var reference | `.vscode/tasks.json` (lines 60, 149) |
| 4 | Update `CODEATLAS_CONFIG` env var reference | `.vscode/mcp.json` (currently points to `codeatlas.example.json`) |
| 5 | Update default config path | `opencode.json` |
| 6 | Update default param | `scripts/mcp-agent.ps1` |
| 7 | Update variable | `scripts/mcp-dev.sh` |
| 8 | Update variable | `scripts/mcp-dev.ps1` |
| 9 | Update prose references | `docs/agent-operations.md`, `README.md` |
| 10 | Investigate `config/data/` — likely generated accidentally, confirm and delete | `config/data/` |

**Note:** `config/codeatlas.example.json`, `codeatlas.windows.example.json`, `codeatlas.wsl.example.json` are kept as reference templates.

---

## Phase 3 — CLI Entry Point: `src/cli/main.ts`

No new third-party dependencies. Uses Node.js `process.argv` parsing.

### Subcommands

| Command | Description |
|---------|-------------|
| `codeatlas list` | List all registered repos with index status |
| `codeatlas register <path> [--name <n>]` | Register repo and trigger refresh |
| `codeatlas refresh <repo>` | Re-index one repository |
| `codeatlas status [repo]` | Show index readiness details |
| `codeatlas search <query> [--repos r1,r2] [--limit n]` | Lexical code search |
| `codeatlas symbol <name> [--repos r1,r2] [--kinds k]` | Symbol lookup |
| `codeatlas read <repo> <file> --start <n> --end <n>` | Read source file range |

Output is human-readable plain text (not JSONL).

### New files
- `src/cli/main.ts` — CLI entry point, reuses `createCodeAtlasServices()`

### `package.json` script additions
```json
"cli": "node --import tsx ./src/cli/main.ts",
"cli:debug": "node --inspect=9230 --import tsx ./src/cli/main.ts"
```

### `.vscode/launch.json` additions

**"Debug CLI"** — `request: "launch"` (not attach), starts CLI in-process with full debugger.
Allows F5 to hit breakpoints anywhere in `src/core/` without needing an MCP client.

---

## Verification Checklist

- [ ] `npm run build:server` — no TypeScript errors
- [ ] `npm test` — all unit and integration tests pass
- [ ] `npm run cli list` — prints repo list
- [ ] `npm run cli search "createCodeAtlasServices"` — returns results
- [ ] F5 → "Debug CLI" — breakpoint in `src/core/runtime.ts` is hit
- [ ] F5 → "Debug CodeAtlas MCP" — attach to port 9230 still works
- [ ] `npm run mcp:agent` — MCP client connects and returns valid `list_repos` response
