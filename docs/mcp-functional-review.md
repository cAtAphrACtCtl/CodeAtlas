# MCP functional review playbook

## Purpose

This document captures a reusable functional review workflow for CodeAtlas MCP development.

Use it when you need to:

- validate MCP behavior against a real stdio server
- reproduce a repository-scoped runtime issue
- add temporary or reusable tracing
- confirm fixes through the same end-to-end path that users and clients hit

## Recommended workflow

### 1. Use a real MCP client, not in-process handler calls

For functional review, prefer a stdio MCP session using the official SDK client.

That validates:

- config loading
- service wiring
- MCP transport behavior
- real tool invocation semantics
- filesystem-backed registry, metadata, and indexes

The reusable script for this is:

- `scripts/mcp-functional-review.mjs`
- `scripts/mcp-refresh-eval.mjs` for refresh-after-update and latency validation through a real MCP session
- `scripts/mcp-lexical-boundary-eval.mjs` for lexical boundary checks that compare ripgrep-backed search with the naive fallback path

### 2. Run against an isolated temporary config

Do not reuse normal local registry or metadata files while reviewing behavior.

The review script should always:

- create a temporary config
- create temporary registry and metadata files
- create a temporary index root
- clean up automatically afterward
- prefer Zoekt when Zoekt binaries are available in the same runtime as the MCP server; only fall back to ripgrep when Zoekt is unavailable

This keeps the review deterministic and avoids polluting local state.

### 3. Cover both happy paths and failure paths

The baseline review should exercise at least:

- MCP tool registration and stable tool presence
- `list_repos` before registration
- `register_repo`
- `get_index_status`
- `code_search`
- `semantic_search` placeholder contract
- `hybrid_search` placeholder contract
- `find_symbol`
- `read_source`
- `refresh_repo`
- duplicate registration failure
- unknown repository failure
- path escape rejection in `read_source`
- out-of-range line request rejection in `read_source`

Important MCP client behavior note:

- tool-level failures do not necessarily reject the MCP client request promise
- many failures come back as a successful protocol response with `isError: true`
- your functional review script should assert on `result.isError` and the returned text payload, not only on promise rejection

### 4. Use opt-in structured logging instead of permanent noisy logs

When a runtime issue is unclear, use debug-level structured logging rather than adding unconditional prints.

Current pattern:

- configure logging through the top-level `logging` block
- for the reusable review scripts, use `CODEATLAS_LOG_LEVEL=debug` to raise the temporary config from `info` to `debug`
- inspect the JSONL `scope` field to focus on the component you care about

Example:

```bash
CODEATLAS_LOG_LEVEL=debug node "scripts/mcp-functional-review.mjs"
```

Guidelines:

- keep MCP tool payloads unchanged
- prefer structured summary counters and small samples over one-log-per-item output
- use `scope` and `event` fields in the JSONL output to isolate the relevant component
- keep `includeErrorStreamTails` enabled when backend process stderr and stdout tails matter for diagnosis
- for lexical review, verify which backend was actually used instead of assuming the configured backend succeeded

### 5. Patch the product behavior, then add regression coverage

If functional review finds a bug:

- patch the implementation first at the correct layer
- add unit or integration coverage for the exact regression
- rerun the same functional review script to confirm the real MCP path is fixed

## Example issue captured with this process

### Issue

`find_symbol` with `exact: true` returned non-exact matches.

Example against this repository:

- query: `createCodeAtlasServices`
- expected: only `createCodeAtlasServices`
- actual: also matched `CreateCodeAtlasServicesOptions` and related symbols

### Root cause

The symbol search path used exact scoring, but not exact-only filtering.

### Fix

`packages/core/src/search/symbol-search-backend.ts` now treats `exact: true` as strict case-insensitive exact-name filtering.

### Regression coverage

- `tests/unit/search-service.test.ts`

### Runtime confirmation

The same real MCP query now returns only the exact symbol match.

## Example commands

Run the full reusable review:

```bash
npm run mcp:functional-review
```

Run with debug-level structured logging:

```bash
CODEATLAS_LOG_LEVEL=debug npm run mcp:functional-review
```

Run the lexical boundary comparison:

```bash
npm run mcp:lexical-boundary-eval
```

Run the refresh evaluation against the current repository:

```bash
npm run mcp:refresh-eval -- --repo-root . --repo-name codeatlas-refresh-eval
```

This workflow reports:

- initial indexing time
- repeated refresh time
- lexical query latency for the supplied probes
- whether a changed token remains stale until `refresh_repo` and then updates correctly after refresh when Zoekt is active

Run the automated verification suite afterward:

```bash
npm test
npm run build:server
```

## Current findings from this playbook

Using this workflow on the current repository surfaced two concrete product issues:

1. `find_symbol exact=true` was not truly exact-only
2. `read_source` allowed `start_line` beyond file length and could return an inconsistent range

Both were patched and revalidated through the same real MCP path.
