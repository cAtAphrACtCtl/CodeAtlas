# CodeAtlas Roadmap

## Phase 1: Local Lexical Retrieval Foundation

Status: core scaffolding implemented; lexical backend direction updated

Deliverables:

- local repository registry
- local metadata store
- index coordination layer
- lexical search backend abstraction
- usable lexical search implementation for local development
- MCP server skeleton with stable tool contracts
- source reading by line range
- basic unit and integration test scaffolding

Exit criteria:

- multiple repositories can be registered locally
- code can be searched through MCP using `code_search`
- source can be read with `read_source`
- repository status can be refreshed independently

Notes:

- the current repository contains a ripgrep-backed lexical path as a bootstrap implementation
- the roadmap direction is to replace that bootstrap lexical path with Zoekt as the primary lexical indexing engine

## Phase 1.5: Zoekt-Backed Lexical Indexing

Planned additions:

- integrate Zoekt as the default lexical indexing and retrieval backend
- build and refresh Zoekt indexes per repository instead of relying on ad hoc query-time scanning
- store Zoekt index readiness and refresh metadata through the existing metadata store
- preserve the existing `code_search` MCP contract while swapping the underlying engine
- introduce runtime backend selection so Zoekt is the default and ripgrep remains a development-only fallback path
- update lexical backend configuration from a ripgrep-specific shape to a backend-specific configuration model

Exit criteria:

- `refresh_repo` builds or refreshes a Zoekt index for one repository without rebuilding others
- `code_search` reads lexical results from Zoekt rather than direct ripgrep execution
- large repository lexical search performance is validated against interactive MCP usage expectations
- fallback scanning is reduced to a bootstrap or troubleshooting path rather than the primary backend
- runtime behavior clearly distinguishes production Zoekt mode from development fallback mode

## Phase 2: Symbol-Aware Retrieval

Status: initial implementation added

Delivered so far:

- symbol extraction pipeline
- symbol index storage
- symbol-oriented search service
- `find_symbol` MCP tool

Remaining additions:

- broaden language coverage beyond the current TS and JS extraction path
- improve symbol ranking and filtering
- add deeper symbol relationship traversal if needed

Notes:

- keep search result contracts aligned with existing result structure where possible
- do not push symbol semantics into the lexical transport boundary
- symbol indexing should align its refresh lifecycle with Zoekt-backed repository refreshes

## Phase 3: Chunk Indexing And Local Embeddings

Planned additions:

- chunking strategy per repository
- local embedding generation
- local embedding artifact management
- semantic candidate retrieval service

Notes:

- implement `semantic_search` behind the already-defined MCP tool contract
- reuse the existing metadata store interface for versioning and artifact state

## Phase 4: Vector Retrieval And Hybrid Ranking

Planned additions:

- vector search backend abstraction
- hybrid candidate merge strategy
- lexical and semantic score normalization
- rank fusion or reranking stage
- result explanations for hybrid decisions
- agent-oriented retrieval policy that treats semantic results as recall candidates and lexical or symbol results as precision signals

Notes:

- implement `hybrid_search` behind the existing contract
- preserve `source_type` values and result schema

## Cross-Cutting Work

Planned improvements across phases:

- move JSON metadata persistence to SQLite if operational needs grow
- improve ignore rules and repository-specific indexing configuration
- add benchmarking for very large repositories
- add ranking evaluation datasets for retrieval quality
- document and enforce an agent retrieval policy: exact symbols go to `find_symbol`, exact text goes to Zoekt-backed `code_search`, vague intent goes to `semantic_search` followed by lexical or symbol verification
- document the Zoekt integration boundary so CodeAtlas does not drift into building a custom lexical indexing engine

## Lexical Backend Decision

Direction:

- do not build a custom lexical indexing engine inside CodeAtlas
- use Zoekt directly for lexical index creation, refresh, and lookup
- keep CodeAtlas responsible for orchestration, metadata, symbol indexing, semantic indexing, and MCP transport
- keep the lexical backend abstraction so Zoekt remains an internal engine choice rather than an MCP contract change

## Guardrails

Across all phases:

- local-first only
- no managed external vector database
- no rewrite of MCP tool names or result schema
- keep storage, indexing, retrieval, and transport separate