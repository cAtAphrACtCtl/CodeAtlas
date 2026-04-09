# Zoekt-First Follow-Up

This file tracks the current project snapshot and the near-term work needed to validate CodeAtlas as a Zoekt-first local code search system before expanding the retrieval surface.

## Status snapshot

Current phase view:

| Bucket | Current state |
| --- | --- |
| Completed | Local repository registration, metadata, repository-scoped refresh, `code_search`, `read_source`, stable MCP tool contracts, Zoekt backend integration, per-repository Zoekt index isolation, and explicit `not_indexed` / `indexing` / `ready` / `stale` / `error` states are in place. |
| In progress | Zoekt hardening is the current mainline: large-repository validation, refresh-after-update correctness, readiness and fallback diagnostics, and evaluation of the experimental TS/JS `find_symbol` path. |
| Not started or deferred | Refresh queueing and concurrency control, automatic stale detection, artifact cleanup and recovery flows, repeatable benchmark and regression gates, and real `semantic_search` / `hybrid_search` implementations are still ahead. |
| Risks and decisions | The project still needs proof that Zoekt refresh stays correct after repository updates, clear rules for when ripgrep fallback is acceptable, isolated measurement of symbol extraction cost, and a keep / limit / remove decision for custom symbol indexing. |

## Top 3 priorities now

1. Prove Zoekt refresh correctness and latency on real repositories.
   - Validate `refresh_repo` after repository updates.
   - Measure initial indexing time, repeated refresh time, and query latency.
   - Verify MCP behavior when indexes are old, refreshing, or unavailable.
2. Harden freshness, fallback, and operator-visible status.
   - Decide how repository updates mark an index stale before the next refresh.
   - Keep the last successful lexical index available while a refresh is running.
   - Document when ripgrep fallback is acceptable versus a hard failure.
3. Make a keep / limit / remove decision on custom symbol indexing.
   - Compare `find_symbol` against Zoekt-first lexical workflows for definition lookup.
   - Measure the refresh cost added by the current custom symbol extraction path.
   - Do not expand custom symbol indexing scope until that decision is made.

## Immediate validation work

Started now:

- `npm run mcp:refresh-eval` runs an isolated real-MCP evaluation that measures initial indexing time, repeated refresh time, query latency, and synthetic refresh-after-update behavior.
- Remaining work is to run that workflow on representative repositories and extend it to old, refreshing, and unavailable index states.

- [ ] Validate `refresh_repo` after repository updates on representative repositories.
- [ ] Measure initial indexing time, repeated refresh time, and query latency with Zoekt as the primary backend.
- [ ] Verify MCP behavior when indexes are old, refreshing, or unavailable.
- [ ] Confirm lexical results remain correct while symbol extraction is skipped, stale, or fails.

## Status and freshness

- [x] Make repository status explicit for `not_indexed`, `indexing`, `ready`, `stale`, and `error`.
- [x] Distinguish lexical readiness from symbol readiness in metadata and MCP-visible status.
- [ ] Decide how repository updates mark an index stale before the next refresh.
- [ ] Keep the last successful lexical index available while a refresh is running.

## Zoekt integration

- [ ] Validate current CLI-based Zoekt integration on Windows and WSL/Linux.
- [ ] Document what counts as acceptable fallback to ripgrep and what counts as a hard failure.
- [ ] Evaluate whether Zoekt service APIs or streaming search are worth adopting separately from indexing.
- [x] Confirm whether Zoekt symbol-aware ranking or `sym:`-style workflows reduce the need for custom symbol indexing.
  - Result: Zoekt `sym:` queries on CargoWise returned hits that did not survive exact filtering; `find_symbol` now falls back to direct ripgrep, so custom symbol indexing is decoupled from the query path but not yet confirmed as removable.
- [x] Isolate per-repository Zoekt index artifacts into dedicated subdirectories.
- [x] Derive Zoekt index root from top-level `indexRoot` config automatically.
- [x] Provide migration path from old shared flat Zoekt index layout.

## Symbol path decision

- [x] Compare `find_symbol` against Zoekt-first lexical workflows for definition lookup.
  - Result: `find_symbol` refactored to use Zoekt-first queries with ripgrep fallback. Zoekt `sym:` prefix did not produce usable results on CargoWise; ripgrep fallback works but is slower (~9-12s) and noisier (cross-language/test hits).
- [ ] Measure the refresh cost added by the current custom symbol extraction path.
- [~] Decide whether custom symbol indexing should be kept, limited, decoupled, or removed.
  - Progress: query path decoupled from custom extraction; extraction still runs but output is unused at query time; formal decision pending.
- [x] Do not expand custom symbol indexing scope until that decision is made.

## Deferred work

- [ ] Keep `semantic_search` and `hybrid_search` as stable placeholder contracts only.
- [ ] Defer chunking, embeddings, and hybrid ranking until Zoekt indexing and refresh behavior are proven.
