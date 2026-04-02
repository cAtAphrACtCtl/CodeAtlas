# Review

Date: 2026-04-02

## Scope

This review covers the current implementation against `docs/large-repository-indexing-design.md`, with emphasis on:

- Zoekt background update mechanism
- index availability and fallback behavior
- performance timing and recording

## Code Review Findings

### Fixed in this iteration

1. Refresh failures no longer leave repositories stuck in `indexing`.

- Problem: `IndexCoordinator.refreshRepositoryInternal()` persisted `state: "indexing"` first, but if refresh work threw before a final status was written, metadata could remain permanently stuck in `indexing`.
- Fix: added an outer error path that persists `state: "error"`, `reason: "refresh_failed"`, failure detail, and `lastRefreshDurationMs` before rethrowing.
- Files:
  - `src/core/indexer/index-coordinator.ts`
  - `src/core/metadata/metadata-store.ts`

2. `symbolConcurrency` now affects real symbol extraction behavior.

- Problem: config defined `indexing.symbolConcurrency`, but runtime still constructed `TypeScriptSymbolExtractor()` without options, and extraction still used unbounded `Promise.all()`.
- Fix: added `TypeScriptSymbolExtractorOptions`, passed `config.indexing.symbolConcurrency` from runtime, and replaced unbounded extraction with a bounded worker loop when concurrency is greater than zero.
- Files:
  - `src/core/search/symbol-extractor.ts`
  - `src/core/runtime.ts`

3. Duplicate `index.symbol_extraction.complete` emission was removed from coordinator-level logging.

- Problem: both `TypeScriptSymbolExtractor` and `IndexCoordinator` emitted the same completion event, which would double-count metrics.
- Fix: the event remains owned by the extractor; coordinator now keeps debug-level local status details and only emits `index.refresh.complete` for the overall refresh.
- Files:
  - `src/core/search/symbol-extractor.ts`
  - `src/core/indexer/index-coordinator.ts`

### Still open after this iteration

1. Refresh is still synchronous and request-bound.

- `register_repo` / `refresh_repo` still block on a full refresh lifecycle.
- This is expected for current Slice 1, but it is still the main large-repository limitation.
- Required next step: implement `submitRefresh()` background job model from the design doc.

2. Zoekt still builds directly into the live repo index directory.

- `getRepoBuildDir()` and `getRepoIndexDir()` still point to the same path.
- That means there is still no `active/` vs `staging/` separation, no atomic promotion, and no last-known-good preservation.
- Required next step: implement staged build directories and explicit promotion.

3. Fallback visibility is still incomplete.

- Current status shows `backend` and `configuredBackend`, which is enough to infer fallback in some cases.
- The explicit model from the design doc is still missing: `active_backend`, `fallback_active`, `fallback_reason`.
- Required next step: add explicit fallback fields in metadata and MCP status responses.

4. Timing coverage is still only partial.

- Implemented now:
  - Zoekt build duration
  - symbol extraction duration
  - total refresh duration
  - Zoekt search execution duration
- Still missing from the design doc:
  - readiness verification duration
  - fallback timing events
  - per-search persisted status fields
  - promotion/staging validation timing

## Functional Review

### Verified working

1. CargoWise now uses the raised Zoekt build timeout.

- Real MCP and log inspection showed `timeoutMs: 1800000` when CargoWise Zoekt indexing started.
- This confirms Slice 1 removed the old hardcoded 120-second build ceiling from the active runtime path.

2. Failure status persistence is fixed in real MCP flow.

- Re-ran `refresh_repo` for `CodeAtlas` with the existing stale repository root entry.
- Previous behavior: repository could remain stuck in `indexing`.
- Current behavior: `get_index_status` now returns:
  - `state: "error"`
  - `reason: "refresh_failed"`
  - `detail` with the underlying ENOENT path error
  - `lastRefreshDurationMs`

### Verified not yet solved

1. CargoWise refresh is still long-running and request-blocking.

- Real CargoWise refresh remained in-flight for more than 10 minutes.
- During that period, the Zoekt directory contained only temp shard files and no final `.zoekt` shards.
- This matches the design doc's current-state analysis and confirms Slice 2 / Slice 3 are still needed.

2. Temp shards are still not promoted to a user-visible ready index during the run.

- This is correct for current safety behavior.
- It also confirms that staged activation has not yet been implemented.

## Tests Added

- `tests/unit/index-coordinator-lifecycle.test.ts`
  - `IndexCoordinator persists error status when refresh throws`
- `tests/unit/symbol-extractor.test.ts`
  - `TypeScriptSymbolExtractor respects configured concurrency`

## Validation Result

- Full test suite passed: `78/78`
- Real MCP regression check passed for failed refresh status persistence
- Real CargoWise functional review confirmed the timeout increase is active

## Iteration Summary

This iteration completed the most concrete fixes surfaced by the review while staying within Slice 1 scope:

- configurable Zoekt timeout is active in runtime
- timing fields are persisted for refresh/build/symbol extraction
- refresh failure state is now diagnosable and non-sticky
- symbol extraction concurrency is now actually configurable
- duplicate symbol timing events were removed

## Recommended Next Implementation Step

Proceed with Slice 2 from the design doc:

1. Add `submitRefresh()` and repository-scoped background jobs
2. Return early from `register_repo` and `refresh_repo` with additive job metadata
3. Extend metadata/status with job phase fields
4. Keep synchronous compatibility wrapper only for old call sites if needed
