# CodeAtlas Current Issues Review

This document summarizes the major project-level issues visible in the current CodeAtlas implementation and provides an opinionated recommendation for each one.

It is intentionally broader than index refresh behavior. The goal is to capture the main product, architecture, runtime, and maintainability risks that are shaping the project right now.

## Summary

The dominant issue in CodeAtlas is not a single bug. It is that the project has already evolved into a local retrieval orchestrator, but several major decisions are still only partially settled:

- the public MCP surface is broader than the implemented product
- the symbol strategy is still in transition
- large-repository scalability is only partially addressed
- runtime reliability still depends heavily on external tool and environment correctness
- documentation has lagged behind the current source layout

## P0 Issues

### 1. Public contract is ahead of implemented capability

Problem:
The project exposes `semantic_search` and `hybrid_search` as stable MCP tools, but they remain placeholder responses rather than active retrieval features.

Why it matters:
This creates a long-term contract burden. The external surface is already committed, but the internal implementation and ranking model are not yet defined. Future work must fit today's shapes and behavior constraints.

Evidence:

- [README.md](../README.md)
- [roadmap.md](roadmap.md)
- [search-service.ts](../src/core/search/search-service.ts#L94)
- [search-service.ts](../src/core/search/search-service.ts#L109)

Opinion:
Keep the tool names, but reduce the implied product weight around them. The project should present them as reserved compatibility surfaces, not as near-term deliverables competing with Zoekt hardening work.

Recommendation:

- keep the stable contracts unchanged
- make placeholder status explicit in top-level docs
- avoid adding more contract surface until the current retrieval stack is operationally stable

### 2. Symbol pipeline is architecturally unresolved

Problem:
`find_symbol` no longer depends on the persisted symbol JSON during query execution, but refresh still performs symbol extraction and writes symbol artifacts.

Why it matters:
The system is paying refresh cost and maintenance cost for a path that is no longer part of the primary query flow. This is a classic sign of a transitional architecture that has not yet been simplified.

Evidence:

- [roadmap.md](roadmap.md)
- [runtime.ts](../src/core/runtime.ts#L80)
- [index-coordinator.ts](../src/core/indexer/index-coordinator.ts#L619)
- [symbol-extractor.ts](../src/core/search/symbol-extractor.ts#L84)
- [symbol-search-backend.ts](../src/core/search/symbol-search-backend.ts#L214)

Opinion:
This is the highest-leverage design decision still open in the project. Until it is settled, the refresh pipeline will remain more complex than it needs to be.

Recommendation:

- formally decide whether symbol extraction is
  - retained as optional enrichment
  - reduced to metrics-only background output
  - removed from the default refresh path
- if retained, define exactly what production behavior depends on it
- if not retained, stop paying default refresh cost for it

### 3. Large-repository scalability is still fragile

Problem:
The refresh model is still full-refresh, request-driven, and repository-scoped. Lexical and symbol work are still sequenced inside one pipeline. Incremental refresh and background maintenance are not present.

Why it matters:
The project explicitly targets very large repositories. The current model can work, but it is not yet a strong long-term operational model for CargoWise-scale repositories.

Evidence:

- [index-coordinator.ts](../src/core/indexer/index-coordinator.ts#L571)
- [symbol-extractor.ts](../src/core/search/symbol-extractor.ts#L113)
- [config.ts](../src/core/configuration/config.ts#L33)
- [roadmap.md](roadmap.md)
- [large-repository-indexing-design.md](large-repository-indexing-design.md)

Opinion:
This is the main technical risk behind both latency and operational instability. Freshness work helps, but it does not solve the core scaling model by itself.

Recommendation:

- prioritize explicit large-repo performance budgets
- separate lexical refresh metrics from symbol refresh metrics in operational review
- introduce an incremental or dirty-repo model before expanding retrieval scope further

## P1 Issues

### 4. Runtime reliability depends heavily on environment correctness

Problem:
CodeAtlas depends on Zoekt executables, path resolution, and runtime-environment consistency across Windows and WSL/Linux.

Why it matters:
The product is only as reliable as its external backend setup. This creates an operational fragility that is larger than typical application-level bugs.

Evidence:

- [AGENTS.md](../AGENTS.md)
- [architecture.md](architecture.md)
- [config.ts](../src/core/configuration/config.ts#L89)

Opinion:
The project is still too easy to misconfigure relative to how central Zoekt is to the intended architecture.

Recommendation:

- keep improving startup-time validation and remediation messages
- reduce ambiguous path-resolution rules where possible
- treat runtime-environment mismatches as a first-class operational risk, not just a support issue

### 5. Status orchestration is becoming a maintenance hotspot

Problem:
State, fallback behavior, service tier, job progress, timing fields, lifecycle status, and freshness watch points are all converging into the metadata model and coordinator logic.

Why it matters:
This centralizes power, but it also makes future changes riskier. Adding more refresh modes or more backends will continue to increase the branching complexity here.

Evidence:

- [metadata-store.ts](../src/core/metadata/metadata-store.ts)
- [index-coordinator.ts](../src/core/indexer/index-coordinator.ts)

Opinion:
Some of this complexity is essential, but some of it is now architectural debt. The coordinator is close to becoming the project's "everything service."

Recommendation:

- keep the status model additive, but slow down new status fields unless they unlock a real operator-facing behavior
- consider separating readiness verification concerns from refresh orchestration concerns before phase-3 style work begins

### 6. Freshness is now detectable, but not proactively maintained

Problem:
The project can now detect some stale conditions, but it still relies on request-driven refresh behavior rather than proactively keeping repositories current.

Why it matters:
This improves correctness, but not yet user experience. Agents and MCP clients may still observe stale-to-refresh transitions at query time.

Evidence:

- [index-coordinator.ts](../src/core/indexer/index-coordinator.ts#L101)
- [zoekt-lexical-search-backend.ts](../src/core/search/zoekt-lexical-search-backend.ts#L480)
- [stale-detection-design.md](stale-detection-design.md)

Opinion:
The current staleness work is necessary, but it is only phase-one freshness behavior. It should not be mistaken for automatic index maintenance.

Recommendation:

- keep the current watch-point checks as a correctness baseline
- if auto-refresh is desired, implement it in CodeAtlas coordinator logic rather than assuming Zoekt will own it

## P2 Issues

### 7. Documentation has drifted from the codebase layout

Problem:
Top-level documentation still describes the repository as package-oriented in places, while the current codebase is structured around `src/core`, `src/mcp-server`, and `src/vscode-extension`.

Why it matters:
This makes onboarding, review, and automated reasoning less accurate than it should be.

Evidence:

- [README.md](../README.md)
- [architecture.md](architecture.md)
- [package.json](../package.json)

Opinion:
This is not the most dangerous issue, but it is one of the cheapest to fix and it improves everything else.

Recommendation:

- keep docs aligned with the real source tree
- describe the extension as an npm workspace package hosted under `src/vscode-extension`, not as a top-level `packages/*` directory
- maintain a small doc map so current design docs are easier to navigate

## Recommended Priority Order

If the project wants the highest return on effort, the next sequence should be:

1. lock the symbol strategy
2. keep Zoekt-first lexical hardening as the main product focus
3. define a large-repository operating model beyond full request-driven refresh
4. continue environment hardening and diagnostics
5. keep documentation synchronized with the actual code structure

## Bottom Line

CodeAtlas is no longer just a Zoekt integration exercise. It is now a local retrieval orchestration system with real lifecycle, status, and backend management concerns.

The biggest risk is not one broken feature. It is indecision at the boundaries: what is core product, what is optional enrichment, and what is still a reserved future surface.

My view is straightforward:

- Zoekt-first lexical retrieval should remain the center of gravity
- symbol extraction should justify its continued default cost or be reduced
- semantic and hybrid work should stay deferred until the current operational model is genuinely stable