# Zoekt-First Follow-Up

This file tracks the near-term work needed to validate CodeAtlas as a Zoekt-first local code search system before expanding the retrieval surface.

## Immediate validation work

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
- [ ] Confirm whether Zoekt symbol-aware ranking or `sym:`-style workflows reduce the need for custom symbol indexing.
- [x] Isolate per-repository Zoekt index artifacts into dedicated subdirectories.
- [x] Derive Zoekt index root from top-level `indexRoot` config automatically.
- [x] Provide migration path from old shared flat Zoekt index layout.

## Symbol path decision

- [ ] Compare `find_symbol` against Zoekt-first lexical workflows for definition lookup.
- [ ] Measure the refresh cost added by the current custom symbol extraction path.
- [ ] Decide whether custom symbol indexing should be kept, limited, decoupled, or removed.
- [ ] Do not expand custom symbol indexing scope until that decision is made.

## Deferred work

- [ ] Keep `semantic_search` and `hybrid_search` as stable placeholder contracts only.
- [ ] Defer chunking, embeddings, and hybrid ranking until Zoekt indexing and refresh behavior are proven.
