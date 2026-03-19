# CodeAtlas Roadmap

## Phase 1: Local Lexical Retrieval

Status: implemented for the core MCP flow and verified locally with `npm test` and `npm run build`

Deliverables:

- local repository registry
- local metadata store
- index coordination layer
- lexical search backend abstraction
- usable lexical search implementation
- MCP server skeleton with stable tool contracts
- source reading by line range
- basic unit and integration test scaffolding

Exit criteria:

- multiple repositories can be registered locally
- code can be searched through MCP using `code_search`
- source can be read with `read_source`
- repository status can be refreshed independently

Current assessment:

- the repository registry, metadata store, index coordination, lexical search path, and MCP handlers are present in the current codebase
- existing unit and integration tests cover the phase 1 lexical flow and stable placeholder contracts for future search modes
- the current implementation is suitable for local iteration on the retrieval surface without changing the MCP contract

Recommended next action:

- start Phase 2 symbol-aware retrieval behind the existing transport boundary, because the phase 1 lexical path is already buildable, testable, and stable enough to serve as the baseline

## Phase 2: Symbol-Aware Retrieval

Planned additions:

- symbol extraction pipeline
- symbol index storage
- symbol-oriented search service
- future `find_symbol` MCP tool if needed

Notes:

- keep search result contracts aligned with existing result structure where possible
- do not push symbol semantics into the lexical transport boundary

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

Notes:

- implement `hybrid_search` behind the existing contract
- preserve `source_type` values and result schema

## Cross-Cutting Work

Planned improvements across phases:

- move JSON metadata persistence to SQLite if operational needs grow
- add stronger local lexical backend support such as Zoekt
- improve ignore rules and repository-specific indexing configuration
- add benchmarking for very large repositories
- add ranking evaluation datasets for retrieval quality

## Guardrails

Across all phases:

- local-first only
- no managed external vector database
- no rewrite of MCP tool names or result schema
- keep storage, indexing, retrieval, and transport separate
