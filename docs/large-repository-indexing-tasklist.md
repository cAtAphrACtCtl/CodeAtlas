# Large Repository Indexing Task List

Status legend: [ ] todo, [~] in progress, [x] done

Related docs:

- `docs/large-repository-indexing-design.md`
- `review.md`

## 0. Current snapshot

- [x] CodeAtlas test suite green after current iteration (`85/85`)
- [x] `register_repo` / `refresh_repo` no longer block on full indexing
- [x] Mid-flight lexical search works while Zoekt is still building
- [x] `get_index_status` exposes background job metadata
- [x] `get_index_status` exposes active fallback backend state
- [x] Latest CargoWise smoke captured usable metrics for next optimization work

## 1. Slice 1: Configurable timeouts and baseline timing

- [x] Add `indexing.indexBuildTimeoutMs` to config model and examples
- [x] Wire configured Zoekt build timeout into runtime backend creation
- [x] Add `indexing.symbolConcurrency` to config model and runtime
- [x] Make symbol extraction concurrency actually effective
- [x] Record Zoekt build duration in metadata
- [x] Record symbol extraction duration in metadata
- [x] Record total refresh duration in metadata
- [x] Add Zoekt build/search timing log events
- [x] Persist refresh failure state instead of leaving repos stuck in `indexing`

## 2. Slice 2: Background refresh and status model

- [x] Add `submitRefresh()` background entrypoint in `IndexCoordinator`
- [x] Keep `refreshRepository()` as compatibility wrapper that awaits completion
- [x] Deduplicate concurrent refresh requests for the same repo
- [x] Return current status instead of blocking when lexical refresh is already in flight
- [x] Update MCP `register_repo` to submit refresh and return immediately
- [x] Update MCP `refresh_repo` to submit refresh and return immediately
- [x] Add job metadata fields to `RepositoryIndexStatus`
- [x] Surface job metadata through `get_index_status`
- [x] Add tests covering background refresh behavior and failure persistence
- [ ] Add a real queued scheduler with global repo concurrency control
- [ ] Add explicit queued state separate from immediate execution
- [ ] Add job cancellation policy or explicit non-support surface

## 3. Availability, fallback, and service quality

- [x] Preserve lexical search during indexing by falling back when Zoekt shards are not ready
- [x] Fast-fail Zoekt search path when final shard directory is missing or empty
- [x] Expose `activeBackend` in status
- [x] Expose `fallbackActive` in status
- [x] Expose `fallbackReason` in status
- [x] Improve diagnostics so indexing status explicitly says when ripgrep is serving lexical search
- [x] Persist last observed lexical search backend in status (`searchBackend`)
- [ ] Introduce explicit service-tier model (`full`, `lexical-only`, `fallback`, `unavailable`)
- [ ] Pre-warm fallback readiness during first-time registration instead of inferring it from config/status

## 4. Performance instrumentation

- [x] Record readiness-check timing events for Zoekt verification
- [x] Record fallback activation events
- [x] Record per-repo lexical search timing events
- [x] Record per-repo symbol search timing events
- [x] Persist last lexical search duration in status (`lastSearchDurationMs`)
- [ ] Add queue wait timing
- [x] Add staging validation timing
- [x] Add promotion timing
- [ ] Decide whether timing history should be retained or only latest values kept

## 5. Performance optimization from CargoWise metrics

- [x] Capture a real CargoWise background smoke baseline
- [x] Confirm mid-flight search returns results before `index.refresh.complete`
- [x] Confirm fallback activation is visible in status and logs
- [x] Identify symbol extraction traversal as a major follow-up hotspot
- [x] Stop symbol extraction from traversing `bin/`, `obj/`, and `publish/`
- [x] Reduce ripgrep fallback work by adding more aggressive early-stop options
- [ ] Re-run full CargoWise end-to-end timing after symbol traversal pruning
- [ ] Evaluate whether symbol extraction should also skip additional generated/vendor trees beyond `bin/`, `obj/`, and `publish/`
- [ ] Decide whether symbol extraction should switch lexical state to ready before symbols complete

## 6. Slice 3: Staged Zoekt activation

- [x] Split repository artifact layout into `active/` and `staging/`
- [x] Add `getRepoActiveDir()` / `getRepoStagingDir()` helpers
- [x] Build Zoekt output into staging instead of live search directory
- [x] Validate staging output before activation
- [x] Atomically promote staging to active
- [x] Preserve last-known-good active index on failed rebuild
- [x] Update readiness verification to inspect active directory only
- [x] Add tests for promotion, rollback, and stale-active behavior during rebuild

## 7. Validation and smoke tracking

- [x] Unit coverage for config/indexing additions
- [x] Unit coverage for refresh dedup and failure persistence
- [x] Unit coverage for Zoekt readiness/fallback behavior
- [x] Unit coverage for explicit fallback diagnostics
- [x] Unit coverage for symbol traversal pruning
- [x] Real CargoWise smoke: non-blocking registration and mid-flight fallback search
- [x] Real CargoWise smoke after staged activation is implemented
- [ ] Real CargoWise smoke after symbol pruning to measure end-to-end refresh improvement

## 8. Latest observed CargoWise metrics

- [x] `register_repo` returned in about `7ms`
- [x] Immediate `get_index_status` returned in about `102ms`
- [x] Mid-flight `code_search` returned `5` results in about `10.0s`
- [x] Mid-flight status showed `activeBackend = ripgrep` and `fallbackActive = true`
- [x] Status persisted `lastSearchDurationMs = 10029` and `searchBackend = ripgrep`
- [x] One full CargoWise Zoekt lexical build completed in about `654213ms`
- [x] Pre-pruning symbol traversal walked about `394029` files before extraction work ramped up

## 9. Next recommended slice

- [x] Finish staged active/staging index promotion so background builds can preserve a last-known-good Zoekt corpus
- [ ] Re-measure CargoWise after the symbol traversal pruning already landed