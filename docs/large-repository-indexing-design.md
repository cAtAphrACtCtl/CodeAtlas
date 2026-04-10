# Large Repository Indexing Design

Status: proposal

Owner: CodeAtlas core

Last updated: 2026-04-02

## Summary

This document focuses on three critical mechanisms required for reliable large-repository (CargoWise-scale) Zoekt support in CodeAtlas:

1. **Zoekt background update mechanism** — how indexing runs decoupled from MCP requests
2. **Index availability determination and fallback** — how CodeAtlas decides whether a search path is usable, and what happens when it is not
3. **Performance timing and recording** — how indexing and search durations are captured for analysis

---

## 1. Zoekt Background Update Mechanism

### 1.1 Current behavior and its limitations

Today, `register_repo` and `refresh_repo` MCP handlers synchronously `await` the full indexing pipeline:

```
handlers.ts registerRepo
  └─ await indexCoordinator.refreshRepository(name)
       └─ refreshRepositoryInternal(name)
            ├─ metadataStore.setIndexStatus({ state: "indexing" })
            ├─ await lexicalBackend.prepareRepository(repo)   // Zoekt build
            ├─ await symbolExtractor.extractRepository(repo)  // symbol walk
            └─ metadataStore.setIndexStatus(finalStatus)
```

Key files: `src/mcp-server/mcp/handlers.ts` (lines 128, 266), `src/core/indexer/index-coordinator.ts` (`refreshRepositoryInternal`).

Problems:

| Problem | Impact |
|---------|--------|
| MCP request blocks until indexing completes | Client must hold the connection open for the full build duration (minutes for large repos) |
| Zoekt build timeout hardcoded at 120s (`defaultZoektRuntime.indexBuildTimeoutMs`) | CargoWise build cannot finish in time; falls back to ripgrep silently |
| Symbol extraction runs in the same blocking chain | Even if Zoekt succeeds, unbounded `Promise.all` over all files adds further latency |
| In-flight dedup via `inFlightRefreshes` Map only dedupes concurrent requests to the same blocking promise | No queue, no background scheduling |

### 1.2 Proposed background update architecture

#### Core concept: fire-and-track

MCP handlers transition from **synchronous await** to **job-start-and-return**:

```
handlers.ts registerRepo / refreshRepo
  ├─ indexCoordinator.submitRefresh(name)  // returns RefreshJob immediately
  ├─ return toToolResult({ index_status, job })  // MCP response sent
  └─ (background) RefreshJob executes asynchronously
```

The caller gets an immediate response containing current index status plus a `job_id` for tracking. Callers poll via `get_index_status` to observe progress.

#### RefreshJob lifecycle

```
                  submitRefresh()
                       │
                       ▼
                   ┌────────┐
                   │ queued  │
                   └───┬────┘
                       │  scheduler picks up
                       ▼
              ┌─────────────────┐
              │ building_lexical│  ← Zoekt index build into staging dir
              └───────┬─────────┘
                      │  build completes
                      ▼
             ┌──────────────────┐
             │validating_lexical│  ← check .zoekt shards exist, no .tmp remains
             └───────┬──────────┘
                     │  validation passes
                     ▼
             ┌──────────────────┐
             │ promoting        │  ← atomic rename staging → active
             └───────┬──────────┘
                     │  promotion succeeds
                     ▼
             ┌──────────────────┐
             │building_symbols  │  ← symbol extraction (bounded concurrency)
             └───────┬──────────┘
                     │
                     ▼
               ┌───────────┐
               │ completed  │
               └───────────┘

  At any point, failure → "failed" or "degraded" state
```

Note: symbol extraction runs **after** lexical promotion, so `state: "ready"` for lexical search can be reached before symbols are available. The metadata model must distinguish `state` (lexical) and `symbolState` independently — this already exists in `RepositoryIndexStatus`, and CodeAtlas now persists that lexical-ready state while symbol extraction is still in flight.

#### Scheduler rules

| Rule | Detail |
|------|--------|
| Per-repo dedup | At most one active job per repository. A new `submitRefresh` while a job is running returns the existing job. |
| Global concurrency | Default `maxConcurrentRepos: 1` for initial implementation. Configurable. |
| Collapse duplicate requests | If repo X is queued and another refresh request arrives, collapse into the same job. |
| Cancellation | Not supported in v1. A running Zoekt child process runs to completion or timeout. |

#### Staged build directories

Current `getRepoBuildDir` and `getRepoIndexDir` both resolve to the same path: `${indexRoot}/repos/<repoKey>/`.

Proposed split:

```
${indexRoot}/repos/<repoKey>/active/      ← search reads from here
${indexRoot}/repos/<repoKey>/staging/     ← Zoekt builds into here
```

Activation flow:

1. Zoekt build writes into `staging/`
2. Validation: at least one `.zoekt` file exists, no `.tmp` files remain
3. Atomic promotion: rename `active/` → `previous/`, rename `staging/` → `active/`
4. Clean up `previous/` on success
5. On failure: delete `staging/`, keep `active/` untouched

This ensures search always reads from a consistent, fully-built index.

#### Implementation changes

| File | Change |
|------|--------|
| `src/core/indexer/index-coordinator.ts` | Add `submitRefresh()` returning `RefreshJob`. Background execution via internal job queue. Keep `refreshRepository()` as a compatibility wrapper that does `submitRefresh` + `await job.promise`. |
| `src/mcp-server/mcp/handlers.ts` | `registerRepo` and `refreshRepo` call `submitRefresh()`, return immediately with job metadata. |
| `src/core/indexer/repo-artifact-path.ts` | Add `getRepoActiveDir()` and `getRepoStagingDir()` alongside existing functions. |
| `src/core/search/zoekt-lexical-search-backend.ts` | `prepareRepository()` accepts a target directory parameter (staging). New `validateStagingDir()` and `promoteStagingToActive()` methods. |
| `src/core/metadata/metadata-store.ts` | Add `RefreshJobState` interface with `jobId`, `phase`, `queuedAt`, `startedAt`, `updatedAt`, `progressMessage`. |
| `src/core/configuration/config.ts` | Add `indexing` block to `CodeAtlasConfig` for `maxConcurrentRepos`, `indexBuildTimeoutMs` override. |

#### MCP response shape (additive)

Current `index_status` response shape is preserved. New fields are additive:

```jsonc
{
  "index_status": {
    "repo": "CargoWise",
    "state": "indexing",           // existing field
    "reason": "refresh_in_progress", // existing field
    "backend": "zoekt",            // existing field
    "configuredBackend": "zoekt",  // existing field
    // --- new additive fields ---
    "job_id": "r-cargowise-1712044800",
    "job_phase": "building_lexical",
    "job_queued_at": "2026-04-02T12:00:00.000Z",
    "job_started_at": "2026-04-02T12:00:01.000Z",
    "job_progress": "Zoekt build in progress"
  }
}
```

Existing clients that ignore unknown fields continue to work.

#### First-time indexing: no last-known-good

When a repository is registered for the first time, there is no previous active index. During background build:

- `state` is `"indexing"`
- search requests fall through to the bootstrap fallback (ripgrep) if `allowBootstrapFallback` is true
- `get_index_status` shows `job_phase: "building_lexical"` so the caller knows build is in progress
- if the build fails, `state` becomes `"error"` with a specific `reason`; ripgrep fallback remains available for search

This is explicit and diagnosable — not a silent degradation.

---

## 2. Index Availability Determination and Fallback Mechanism

### 2.1 Current readiness verification chain

When a search request arrives, `SearchService.searchLexical()` calls `indexCoordinator.ensureLexicalReady(repoName)` for each target repository. The full decision chain is:

```
SearchService.searchLexical()
  └─ indexCoordinator.ensureLexicalReady(repo)
       ├─ metadataStore.getIndexStatus(repo)
       │   └─ if state == "ready":
       │       └─ validateStoredLexicalReadyStatus(repo, existing)
       │            └─ lexicalBackend.verifyRepositoryReady(repo, existing)
       │                 ├─ CHECK 1: configuredBackend matches current backend kind?
       │                 ├─ CHECK 2: stored backend matches current backend kind?
       │                 │    └─ if mismatch + allowBootstrapFallback:
       │                 │         delegate to bootstrapBackend.verifyRepositoryReady()
       │                 ├─ CHECK 3: Zoekt executables available? (cached)
       │                 ├─ CHECK 4: index directory exists and is a directory?
       │                 └─ CHECK 5: directory contains at least one .zoekt shard file?
       │
       │   └─ if ready == false: invalidate stored status, trigger refresh
       │   └─ if not "ready" or validation fails:
       └─ refreshRepository(repo)  // full re-index
```

Implemented in: `zoekt-lexical-search-backend.ts` `verifyRepositoryReady()`.

### 2.2 Readiness check details

Each check produces a specific `IndexStatusReason` for diagnostics:

| Check | Condition | Failure Reason | Resulting State |
|-------|-----------|---------------|-----------------|
| 1. Backend config match | `configuredBackend !== "zoekt"` | `configured_backend_mismatch` | `stale` |
| 2. Stored backend match | `existing.backend !== "zoekt"` | `fallback_backend_unverified` | `stale` |
| 3. Zoekt availability | `zoekt-index -help` or `zoekt -help` fails | `zoekt_unavailable` | `stale` |
| 4. Index dir exists | `stat(indexDir)` fails with ENOENT | `zoekt_index_missing` | `stale` |
| 4b. Index dir is dir | `stat(indexDir).isDirectory() == false` | `zoekt_index_not_directory` | `stale` |
| 5. Shard files exist | No files matching `*.zoekt` in index dir | `zoekt_index_no_shards` | `stale` |
| (exception) | Any error during checks | `zoekt_index_inspection_failed` | `error` |

If all five checks pass, `verifyRepositoryReady` returns `{ ready: true }`.

### 2.3 Fallback mechanism

Fallback operates at two levels:

#### Level 1: Indexing-time fallback (`prepareRepository`)

When Zoekt build fails (timeout, crash, unavailable), `prepareWithFallback()` delegates to the bootstrap backend (ripgrep):

```
prepareRepository(repo)
  ├─ Zoekt available?
  │    NO → prepareWithFallback(repo, detail, "zoekt_unavailable")
  │
  ├─ execFile("zoekt-index", ...) with timeout
  │    FAIL → prepareWithFallback(repo, detail, "zoekt_index_build_failed")
  │
  └─ SUCCESS → return { state: "ready", backend: "zoekt" }

prepareWithFallback(repo, detail, reason)
  ├─ allowBootstrapFallback && bootstrapBackend exists?
  │    YES → bootstrapBackend.prepareRepository(repo)
  │           return { ...fallbackStatus, reason, detail: "...using bootstrap fallback..." }
  │
  └─ NO → return { state: "error", reason, detail }
```

The returned status preserves the `reason` so diagnostics show why Zoekt was not used.

#### Level 2: Search-time fallback (`searchRepository`)

When a search request against a Zoekt index fails:

```
searchRepository(repo, request)
  ├─ Zoekt available?
  │    NO → searchWithFallback(repo, request, detail)
  │
  ├─ execFile("zoekt", ["-index_dir", indexDir, query])
  │    FAIL → searchWithFallback(repo, request, detail)
  │
  └─ SUCCESS → parse and return hits

searchWithFallback(repo, request, detail)
  ├─ allowBootstrapFallback && bootstrapBackend?
  │    YES → bootstrapBackend.searchRepository(repo, request)
  └─ NO → throw Error(detail)
```

#### Fallback visibility

The current fallback is partially silent — after `prepareWithFallback` succeeds, the metadata records `backend: "ripgrep"` with `configuredBackend: "zoekt"`, but the MCP response diagnostics only surface this if the caller inspects `index_status` closely.

### 2.4 Proposed improvements to availability and fallback

#### Improvement 1: Separate active vs. configured backend visibility

Make the distinction between "what the user configured" and "what is actually serving search" always visible:

```jsonc
{
  "index_status": {
    "configured_backend": "zoekt",      // user intent
    "active_backend": "ripgrep",        // what actually serves search
    "fallback_active": true,            // explicit boolean
    "fallback_reason": "zoekt_index_build_failed: timeout after 120000ms"
  }
}
```

#### Improvement 2: Readiness verification with staging awareness

After introducing staged builds, `verifyRepositoryReady()` must check the **active** directory, not the staging directory:

```
verifyRepositoryReady(repo)
  ├─ resolve activeDir = getRepoActiveDir(indexRoot, repo.name, repo.rootPath)
  ├─ (existing checks 1-5 against activeDir)
  └─ additionally: if staging build is in progress, add diagnostic note
```

#### Improvement 3: Graceful degradation tiers

Define explicit tiers of service quality:

| Tier | Condition | Search Behavior |
|------|-----------|-----------------|
| **Full** | Active lexical backend ready, symbol extraction/enrichment completed | Lexical search available; enriched symbol metadata is current |
| **Lexical-only** | Active lexical backend ready, symbols pending/failed | Lexical search and lexical-backed `find_symbol` available; enrichment data may be stale or partial |
| **Fallback** | Configured lexical backend not active, fallback backend serving | Degraded lexical search via fallback backend |
| **Unavailable** | No ready lexical backend can be confirmed | Search returns error or waits for a backend to become ready |

Each tier is recorded in metadata and visible in `get_index_status` via `serviceTier`.

#### Improvement 4: First-time registration fallback policy

When `register_repo` is called for a new repository:

1. Submit background refresh job
2. Immediately prepare ripgrep fallback index (fast, seconds not minutes)
3. Set `state: "indexing"`, `active_backend: "ripgrep"`, `fallback_active: true`
4. When Zoekt build completes → promote to active, set `active_backend: "zoekt"`, `fallback_active: false`

This ensures search is available from the moment of registration, even for very large repos.

### 2.5 Complete availability decision flowchart

```
Search request arrives for repo R
  │
  ├─ metadataStore.getIndexStatus(R)
  │
  ├─ state == "ready" ?
  │    YES → verifyRepositoryReady(R)
  │           ├─ ready == true → USE ACTIVE INDEX (Zoekt)
  │           └─ ready == false → mark stale, attempt refresh
  │
  ├─ state == "indexing" ?
  │    YES → is there a previous active index?
  │           ├─ YES → USE PREVIOUS ACTIVE INDEX (stale but available)
  │           └─ NO  → is fallback available?
  │                     ├─ YES → USE RIPGREP FALLBACK
  │                     └─ NO  → RETURN ERROR with job progress info
  │
  ├─ state == "stale" ?
  │    YES → trigger background refresh
  │          └─ serve from existing stale index meanwhile
  │
  ├─ state == "error" ?
  │    YES → is fallback available?
  │           ├─ YES → USE RIPGREP FALLBACK
  │           └─ NO  → RETURN ERROR with diagnostic detail
  │
  └─ state == "not_indexed" ?
       YES → trigger background refresh
             └─ is fallback available?
                  ├─ YES → USE RIPGREP FALLBACK
                  └─ NO  → RETURN ERROR ("not yet indexed")
```

---

## 3. Performance Timing and Recording

### 3.1 Current timing infrastructure

The logging system already has the building blocks:

| Component | What it records | Where |
|-----------|----------------|-------|
| `withRequestContext` (handlers.ts) | Total MCP request duration (`durationMs`) | `mcp.request.complete` / `mcp.request.error` events |
| `LogEvent.durationMs` field | Available on any log event | `src/core/logging/types.ts` |
| `Logger` with scopes | Structured events with `scope`, `event`, `requestId`, `operationId` | `src/core/logging/logger.ts` |
| `RequestLogContext` via AsyncLocalStorage | Per-request `requestId`, `operationId`, `toolName` correlation | `src/core/logging/context.ts` |

What is **missing**:

- Per-phase indexing timing (lexical build vs. symbol extraction vs. promotion)
- Per-repository search latency
- Timing exposed in metadata (not just logs)
- Aggregatable metrics (not just individual log events)

### 3.2 Proposed timing points

#### 3.2.1 Indexing timing

Record duration for each phase of the refresh job:

| Timing Point | Start | End | Stored In |
|-------------|-------|-----|-----------|
| **Total refresh** | `submitRefresh()` called | Job reaches `completed`/`failed` | `RefreshJobState.totalDurationMs` |
| **Queue wait** | Job enters `queued` | Job enters `building_lexical` | `RefreshJobState.queueWaitMs` |
| **Zoekt build** | `execFile("zoekt-index", ...)` called | Process exits | `RefreshJobState.zoektBuildDurationMs` |
| **Staging validation** | Shard file checks begin | Validation complete | `RefreshJobState.validationDurationMs` |
| **Promotion** | Rename `staging/` → `active/` | Rename complete | `RefreshJobState.promotionDurationMs` |
| **Symbol extraction** | `symbolExtractor.extractRepository()` called | Extraction complete | `RefreshJobState.symbolExtractionDurationMs` |

Implementation: wrap each phase in the refresh job with `performance.now()` bookends.

```typescript
// In refreshRepositoryInternal (or new RefreshJob.execute):
const zoektStart = performance.now();
await this.runtime.execFile(zoektIndexExecutable, args, options);
const zoektDurationMs = Math.round(performance.now() - zoektStart);

this.logger?.info("indexer", "zoekt build completed", {
  event: "index.zoekt_build.complete",
  repo: repository.name,
  durationMs: zoektDurationMs,
  // shard count, staging dir size, etc.
});
```

#### 3.2.2 Search timing

Record duration for each search operation at two levels:

| Timing Point | Where | Metric |
|-------------|-------|--------|
| **MCP request total** | `withRequestContext` in handlers.ts | Already recorded as `durationMs` on `mcp.request.complete` |
| **Per-repo lexical search** | `zoekt-lexical-search-backend.ts` `searchRepository()` | New: `search.lexical.complete` event with `durationMs` |
| **Per-repo symbol search** | `symbol-search-backend.ts` `searchRepository()` | New: `search.symbol.complete` event with `durationMs` |
| **Readiness verification** | `verifyRepositoryReady()` | New: `index.readiness_check.complete` event with `durationMs` |
| **Zoekt process execution** | `execFile("zoekt", ...)` | New: `search.zoekt_exec.complete` event with `durationMs`, `hitCount` |

Implementation in `searchRepository()`:

```typescript
async searchRepository(repository, request) {
  const searchStart = performance.now();
  // ... existing search logic ...
  const searchDurationMs = Math.round(performance.now() - searchStart);

  this.logDebug("completed zoekt searchRepository", {
    event: "search.zoekt_exec.complete",
    repo: repository.name,
    query: request.query,
    hitCount: hits.length,
    durationMs: searchDurationMs,
    backend: "zoekt",  // or "ripgrep" if fallback was used
  });
  return hits;
}
```

#### 3.2.3 Fallback timing

When fallback activates, record both the failed attempt and the fallback:

```typescript
// In searchWithFallback / prepareWithFallback:
this.logger?.info("zoekt", "fallback activated", {
  event: "search.fallback.activated",
  repo: repository.name,
  originalBackend: "zoekt",
  fallbackBackend: this.bootstrapBackend.kind,
  failureReason: detail,
  originalDurationMs: failedAttemptDurationMs,
});
```

### 3.3 Timing data in metadata store

Extend `RepositoryIndexStatus` with timing fields:

```typescript
export interface RepositoryIndexStatus {
  // ... existing fields ...

  // Indexing timing (populated after refresh completes)
  lastRefreshDurationMs?: number;          // total refresh duration
  lastZoektBuildDurationMs?: number;       // Zoekt build phase only
  lastSymbolExtractionDurationMs?: number; // symbol phase only
  lastPromotionDurationMs?: number;        // staging → active rename

  // Search timing (rolling averages or last-observed)
  lastSearchDurationMs?: number;           // last search latency
  searchBackend?: string;                  // backend that served last search
}
```

This data is exposed via `get_index_status` so callers can understand performance without parsing logs.

### 3.4 Structured log event catalog

All timing-related events follow the `domain.action.result` naming convention:

| Event Name | Scope | Emitted By | Key Fields |
|-----------|-------|------------|------------|
| `mcp.request.start` | mcp | handlers.ts | `toolName` |
| `mcp.request.complete` | mcp | handlers.ts | `toolName`, `durationMs` |
| `mcp.request.error` | mcp | handlers.ts | `toolName`, `durationMs`, `error` |
| `index.refresh.queued` | indexer | IndexCoordinator | `repo`, `jobId` |
| `index.refresh.started` | indexer | IndexCoordinator | `repo`, `jobId` |
| `index.zoekt_build.start` | zoekt | ZoektLexicalSearchBackend | `repo`, `buildDir`, `timeoutMs` |
| `index.zoekt_build.complete` | zoekt | ZoektLexicalSearchBackend | `repo`, `durationMs`, `shardCount` |
| `index.zoekt_build.failed` | zoekt | ZoektLexicalSearchBackend | `repo`, `durationMs`, `error` |
| `index.staging_validation.complete` | indexer | IndexCoordinator | `repo`, `shardCount`, `durationMs`, `valid` |
| `index.promotion.complete` | indexer | IndexCoordinator | `repo`, `durationMs` |
| `index.symbol_extraction.start` | symbol-extractor | SymbolExtractor | `repo`, `fileCount` |
| `index.symbol_extraction.complete` | symbol-extractor | SymbolExtractor | `repo`, `durationMs`, `symbolCount` |
| `index.refresh.complete` | indexer | IndexCoordinator | `repo`, `jobId`, `totalDurationMs`, `state` |
| `index.refresh.failed` | indexer | IndexCoordinator | `repo`, `jobId`, `totalDurationMs`, `reason` |
| `search.lexical.start` | search-service | SearchService | `repo`, `query` |
| `search.lexical.complete` | search-service | SearchService | `repo`, `query`, `durationMs`, `hitCount`, `backend` |
| `search.zoekt_exec.complete` | zoekt | ZoektLexicalSearchBackend | `repo`, `durationMs`, `hitCount` |
| `search.fallback.activated` | zoekt | ZoektLexicalSearchBackend | `repo`, `originalBackend`, `fallbackBackend`, `reason` |
| `search.symbol.complete` | search-service | SearchService | `repo`, `query`, `durationMs`, `resultCount` |
| `index.readiness_check.complete` | zoekt | ZoektLexicalSearchBackend | `repo`, `durationMs`, `ready`, `reason` |

### 3.5 Performance analysis workflow

With the above instrumentation, performance questions can be answered:

| Question | How to answer |
|----------|--------------|
| How long does CargoWise initial build take? | Filter log: `event == "index.zoekt_build.complete"`, `repo == "CargoWise"` → `durationMs` |
| How long does a refresh take end-to-end? | `index.refresh.complete` → `totalDurationMs` |
| Is search latency acceptable? | `search.lexical.complete` → `durationMs` per repo |
| How often does fallback activate? | Count `search.fallback.activated` events per repo |
| What fraction of time is Zoekt build vs. symbol extraction? | Compare `zoektBuildDurationMs` vs. `symbolExtractionDurationMs` from metadata |
| Is queue wait significant? | `index.refresh.started.timestamp - index.refresh.queued.timestamp` |

These can also be exposed via `get_index_status` for programmatic access:

```jsonc
{
  "index_status": {
    "repo": "CargoWise",
    "state": "ready",
    "active_backend": "zoekt",
    "last_refresh_duration_ms": 385000,
    "last_zoekt_build_duration_ms": 340000,
    "last_symbol_extraction_duration_ms": 42000,
    "last_search_duration_ms": 120,
    "shard_count": 12
  }
}
```

---

## Implementation Slices

Based on the three focus areas, the recommended implementation order is:

### Slice 1: Configurable timeouts + basic timing

- Make `indexBuildTimeoutMs` configurable in `CodeAtlasConfig` (unblocks CargoWise)
- Add `durationMs` logging to `prepareRepository()` and `searchRepository()`
- Add `lastRefreshDurationMs` and `lastZoektBuildDurationMs` to `RepositoryIndexStatus`
- Keep current synchronous flow

### Slice 2: Background job + status model

- Add `submitRefresh()` to IndexCoordinator with job state tracking
- Update MCP handlers to return immediately with job metadata
- Add `job_id`, `job_phase`, `job_started_at` to status response
- Add per-phase timing to refresh job

### Slice 3: Staged build + availability improvements

- Split `getRepoBuildDir`/`getRepoIndexDir` into `active/` and `staging/`
- Implement `validateStagingDir()` and `promoteStagingToActive()`
- Update `verifyRepositoryReady()` to check active dir only
- Add `fallback_active` and `fallback_reason` to status response
- Add first-time registration ripgrep bootstrap

### Slice 4: Full timing instrumentation

- Complete structured event catalog
- Add search-time per-repo timing
- Add readiness check timing
- Add fallback activation recording
- Expose timing summary in `get_index_status`

## Open Questions

- Lexical readiness should go active before symbol extraction finishes. CodeAtlas now persists `state: "ready"` with `symbolState: "indexing"` so `code_search` and lexical-backed `find_symbol` can run while enrichment extraction continues in the background.
- What is the right `indexBuildTimeoutMs` default for large repos? (Candidate: 1800000ms = 30 min)
- Should timing data be persisted across server restarts or treated as ephemeral?
- Should `get_index_status` return timing history (last N refreshes) or only the most recent?