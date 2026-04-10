# Documentation Alignment Audit (2026-04-10)

## Scope

This audit checks documentation statements against the current implementation in `src/`.

Primary evidence sources:

- `src/core/search/search-service.ts`
- `src/core/indexer/index-coordinator.ts`
- `src/core/search/zoekt-lexical-search-backend.ts`
- `src/core/metadata/metadata-store.ts`

## High-Priority Findings

### 1. Staleness wording in architecture is ambiguous

Status: Open
Severity: High

Doc statement:

- `docs/architecture.md` currently says automatic repository change detection is still future work.

Code reality:

- Request-driven source change detection is already implemented in lexical readiness verification via `checkSourceStaleness(...)`.
- `sourceRootMtime` and `gitHeadMtime` are captured during refresh.

Evidence:

- `src/core/indexer/index-coordinator.ts` (`captureWatchPoints`)
- `src/core/search/zoekt-lexical-search-backend.ts` (`checkSourceStaleness`)

Recommended edit:

- Replace the wording with: proactive/background auto-refresh is future work; request-driven stale detection is already implemented.

---

### 2. Zoekt follow-up checklist has one stale checkbox state

Status: Open
Severity: High

Doc statement:

- `docs/zoekt-first-todo.md` still has:
  - `[ ] Keep semantic_search and hybrid_search as stable placeholder contracts only.`

Code and product reality:

- This is already true in current implementation and contract behavior.

Evidence:

- `src/core/search/search-service.ts` (`searchSemantic`, `searchHybrid` return placeholder responses)

Recommended edit:

- Mark the item as `[x]` or convert to a policy note instead of an actionable TODO.

---

### 3. Design documents mix implemented behavior and planned behavior in the same voice

Status: Open
Severity: High

Affected docs:

- `docs/large-repository-indexing-design.md`

Code reality:

- Current implementation includes per-repo in-flight dedup and per-request refresh orchestration.
- Proposed scheduler concepts (for example global repo queue and configurable global repo concurrency) are not present in current `src/` runtime config or coordinator API.

Evidence:

- `src/core/indexer/index-coordinator.ts`
- `src/core/configuration/config.ts`

Recommended edit:

- Add explicit tags in this file per section:
  - `Implemented`
  - `Partially Implemented`
  - `Planned`
- This avoids readers interpreting planned scheduler semantics as current product behavior.

## Medium-Priority Findings

### 4. Symbol path messaging is mostly aligned but still fragmented across docs

Status: Open
Severity: Medium

Current reality:

- Query path: lexical-first symbol lookup (`find_symbol`)
- Background path: optional symbol extraction artifact generation
- Readiness gate for `find_symbol`: lexical readiness (not `symbolState=ready`)

Risk:

- Multiple docs describe this correctly now, but not with one canonical wording. This can drift again.

Recommended edit:

- Add a short canonical paragraph in `README.md` and reference it from `architecture.md` and `roadmap.md`.
- Suggested canonical label: `Query-time symbol lookup vs refresh-time symbol enrichment`.

---

### 5. Service tier semantics need one canonical source of truth in docs

Status: Open
Severity: Medium

Current reality:

- `serviceTier` is derived in metadata and surfaced in status/diagnostics.
- `lexical-only` can still support lexical-backed `find_symbol` behavior.

Evidence:

- `src/core/metadata/metadata-store.ts` (`deriveServiceTier`)
- `src/core/diagnostics/index-status-diagnostics.ts`

Recommended edit:

- Add a dedicated section in `docs/architecture.md` that defines service tiers by current runtime behavior, and link other docs to it instead of redefining tier semantics.

## Low-Priority Findings

### 6. Historical examples in functional-review doc can be misread as current defects

Status: Open
Severity: Low

Doc statement:

- `docs/mcp-functional-review.md` includes historical bug examples (which is useful), but can be read as current open issues if skimmed.

Recommended edit:

- Prefix the section title with `Historical Example` and add one sentence: `This issue is fixed; this section documents the prior failure pattern and regression method.`

## Suggested Execution Order

1. Fix wording ambiguity in `docs/architecture.md` (Finding 1).
2. Close the stale TODO in `docs/zoekt-first-todo.md` (Finding 2).
3. Add implementation-status tags in `docs/large-repository-indexing-design.md` (Finding 3).
4. Add one canonical symbol-path paragraph and reference links (Finding 4).
5. Centralize service-tier semantics in one section (Finding 5).
6. Label historical examples explicitly in review playbook (Finding 6).

## Result

Overall alignment is much better than before.

The remaining drift is no longer about major wrong architecture claims; it is mostly about:

- ambiguous wording
- checklist status lag
- planned-vs-implemented boundary clarity in design documents
- canonical phrasing consistency across docs
