# CodeAtlas Roadmap

This roadmap tracks implemented work, active hardening, and planned phases separately so the project status stays aligned with the repository.

CodeAtlas remains guided by a few stable constraints:

- local-first indexing, metadata, and retrieval
- multi-repository support with repository-scoped refresh
- stable MCP tool contracts as internals evolve
- clear separation between lexical, symbol, and future semantic retrieval layers

## Current Snapshot

Status today:

- local repository registration, metadata, source reading, and repository-scoped refresh are implemented
- `code_search` is implemented behind a lexical backend abstraction
- Zoekt integration is present and is the intended primary lexical backend
- ripgrep remains available as a bootstrap or development fallback
- `find_symbol` is implemented with a local TS and JS symbol indexing path
- `semantic_search` and `hybrid_search` already exist as stable MCP contract surfaces but still return structured placeholder responses

Current near-term focus:

- finish Zoekt operational hardening and large-repository validation
- improve symbol coverage and ranking quality
- add clearer operational diagnostics, refresh control, and evaluation coverage

## Phase 1: Local Lexical Retrieval Foundation

Status: implemented

Delivered:

- local repository registry
- local metadata store
- repository-scoped index coordination
- lexical backend abstraction
- usable local lexical retrieval path
- MCP server with stable tool contracts for core retrieval flows
- source reading by repository-relative path and line range
- basic unit and integration test scaffolding

Exit criteria met:

- multiple repositories can be registered locally
- code can be searched through `code_search`
- source can be read through `read_source`
- repository status can be refreshed independently through `refresh_repo`

## Phase 1.5: Zoekt-Backed Lexical Indexing

Status: hardening

Delivered so far:

- Zoekt lexical backend adapter
- runtime backend selection between Zoekt and ripgrep
- repository-scoped lexical refresh flow through the existing coordinator
- Windows-native and WSL/Linux configuration examples
- Windows installer scripts with source-build fallback for Zoekt binaries

Remaining work:

- validate interactive query latency and refresh cost on representative large repositories
- improve diagnostics for backend misconfiguration and recovery
- make fallback behavior more explicit in metadata and user-visible status
- tighten operational guidance around when ripgrep fallback is acceptable

Exit criteria:

- `refresh_repo` refreshes exactly one repository through Zoekt without rebuilding unrelated repositories
- `code_search` uses Zoekt when configured and available
- ripgrep fallback is clearly treated as development or troubleshooting behavior rather than the default production path
- backend readiness and failure states are explicit in metadata and user-visible results

## Phase 2: Symbol-Aware Retrieval

Status: partial

Delivered so far:

- local TypeScript and JavaScript symbol extraction during repository refresh
- local symbol index storage
- symbol search backend with exact, prefix, and substring matching
- `find_symbol` MCP tool
- query-time readiness checks that stay aligned with repository refresh behavior

Remaining work:

- broaden language coverage beyond the current TS and JS path
- improve ranking and filtering for common symbol lookup workflows
- add deeper symbol relationships only if real usage justifies the added complexity
- add stronger regression coverage for ranking behavior and partial failure cases

Exit criteria:

- exact symbol lookup works reliably for supported languages
- symbol indexing failure remains explicit and does not mask lexical readiness state
- symbol ranking behavior is covered by representative tests and query cases
- symbol indexing stays aligned with repository-scoped refresh semantics

## Phase 2.5: Operational Hardening And Evaluation

Status: planned

Why this phase exists:

- core retrieval capabilities are already usable
- operational safety, measurability, and recovery behavior need to catch up before larger semantic work is added

Planned work:

- refresh queueing and concurrency control
- stale index detection and clearer repository status transitions
- artifact cleanup and recovery flows for broken metadata or missing index files
- benchmark suites for large repositories
- retrieval quality datasets and regression evaluation
- more explicit user-visible diagnostics for ready, stale, partial, and error states

Exit criteria:

- duplicate refresh requests are coalesced or controlled predictably
- representative benchmark data exists for large-repository refresh and query behavior
- retrieval quality regressions can be detected through repeatable evaluation
- operators can distinguish ready, stale, partial, and error states without inspecting internals manually

## Phase 3: Chunk Indexing And Local Embeddings

Status: planned

Prerequisites:

- operational hardening from phase 2.5
- repository-scoped artifact lifecycle and evaluation foundations

Planned additions:

- chunking strategy per repository
- local chunk storage
- local embedding generation
- embedding artifact versioning and invalidation rules
- semantic retrieval backend behind the existing `semantic_search` contract

Contract rule:

- `semantic_search` already exists as a stable MCP surface and should move from placeholder to real implementation without renaming the tool or reshaping the contract

Exit criteria:

- `semantic_search` returns local semantic candidates under the existing contract
- chunk and embedding artifacts are repository-scoped and versioned
- missing or stale embedding state is reported explicitly rather than appearing as silent success
- semantic retrieval remains fully local-first

## Phase 4: Vector Retrieval And Hybrid Ranking

Status: planned

Planned additions:

- vector search backend abstraction
- lexical and semantic candidate merge strategy
- score normalization and rank fusion
- optional symbol-aware reranking or verification where it improves precision
- explanation or diagnostic support for hybrid ranking decisions

Contract rule:

- `hybrid_search` must keep the current stable MCP surface while the internal ranking pipeline evolves

Exit criteria:

- `hybrid_search` merges candidates without changing the tool contract
- ranking behavior is benchmarked on representative query sets
- cross-repository score normalization is deliberate and regression-tested
- hybrid retrieval remains explainable enough to debug relevance regressions

## Cross-Cutting Workstreams

### Platform Compatibility

- keep Windows-native and WSL/Linux runtime models consistent
- avoid automatic path translation assumptions between Windows and WSL
- keep executable paths, repository paths, and index paths in the same runtime environment

### Storage Evolution

- keep JSON-backed registry and metadata while it remains operationally sufficient
- move to SQLite only for concrete needs such as richer artifact bookkeeping, concurrent updates, or more complex status queries

### Documentation And Contract Discipline

- update `README.md`, `docs/architecture.md`, and `docs/roadmap.md` when behavior, boundaries, or project status changes
- keep roadmap status aligned with implemented reality rather than aspiration
- prefer additive MCP changes over breaking contract changes

### Testing And Benchmarking

- add unit tests for indexing, search, ranking, configuration, and backend selection behavior
- add integration tests for MCP request and response behavior
- keep placeholder contract tests for `semantic_search` and `hybrid_search` until those implementations land
- add benchmark and evaluation coverage before expanding the retrieval surface significantly

## Near-Term Priorities

- finish Zoekt hardening and large-repository validation
- improve symbol ranking quality and supported language coverage
- add refresh control, stale detection, and clearer status diagnostics
- build the evaluation foundation needed before implementing semantic retrieval
