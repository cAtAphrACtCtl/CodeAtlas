# CodeAtlas

CodeAtlas is a local multi-repository code retrieval platform designed for GitHub Copilot and MCP-based agents.

Its goal is to provide fast, local-first code search and repository context retrieval for large multi-repo environments.

## Goals

- Support 5-10 repositories with one very large repository up to 10GB
- Keep indexing and storage fully local
- Expose search and source-reading capabilities through MCP
- Work well with GitHub Copilot and future custom skills
- Start with lexical retrieval and be extensible to hybrid retrieval later

## Non-Goals

- Do not build a cloud-hosted search platform
- Do not depend on external managed vector databases
- Do not optimize for UI-first browsing in phase 1
- Do not implement full semantic retrieval in the initial milestone

## Phase 1 Scope

Phase 1 focuses on a local lexical code retrieval platform.

Core capabilities:
- Register and manage multiple local repositories
- Build and refresh local indexes
- Search code across repositories
- Read source file ranges
- Return structured search results for Copilot agents through MCP

## Future Phase 2+ Scope

Future phases may add:
- Symbol-aware retrieval
- Chunk-based indexing
- Local embeddings
- Hybrid lexical + semantic retrieval
- Re-ranking and repository-aware ranking
- Deeper agent workflows and skills

## Architecture

Main components:
- Repository Registry
- Index Coordinator
- Lexical Search Backend
- MCP Server
- Source Reader
- Metadata Store

Recommended phase 1 architecture:
- Lexical search backend: Zoekt
- Metadata store: SQLite
- MCP server: Node.js or Python
- Deployment: local machine, optionally WSL2 for indexing

## High-Level Flow

1. Repositories are registered in the local registry
2. The index coordinator builds or refreshes local indexes
3. MCP tools expose search and source access
4. GitHub Copilot calls MCP tools
5. Copilot reads results and performs analysis

## Repository Structure

Suggested structure:

/docs
  architecture
  decisions
  operations

/src
  registry
  indexer
  search
  mcp
  reader
  common

/tests
  unit
  integration

/scripts
  bootstrap
  index
  dev

/data
  registry
  metadata
  indexes

## Core MCP Tools

Phase 1 tools:
- list_repos
- code_search
- read_source
- get_index_status

Future tools:
- find_symbol
- semantic_search
- hybrid_search
- rebuild_index
- refresh_repo

## Search Result Contract

Every search result should include:
- repo
- path
- branch
- start_line
- end_line
- snippet
- score
- source_type

Where source_type initially is:
- lexical

In future phases source_type may also be:
- semantic
- hybrid

## Coding Standards

- Prefer simple, explicit modules over abstract frameworks
- Keep interfaces stable for future hybrid retrieval upgrades
- Separate indexing concerns from MCP transport concerns
- Keep repository metadata independent from the search engine implementation
- Design for incremental indexing and partial refresh

## Operational Requirements

- All indexes must be local
- All repository metadata must be local
- The platform must continue to work offline after initial setup
- Large repository indexing must not require reindexing all repositories together
- Repositories must be refreshable independently

## Delivery Plan

Phase 1:
- Repository registry
- Zoekt integration
- SQLite metadata
- MCP server with code_search and read_source
- Basic developer scripts
- Bootstrap documentation

Phase 2:
- Symbol extraction
- Chunking model
- Better result shaping

Phase 3:
- Local embeddings
- Vector index
- semantic_search

Phase 4:
- hybrid_search
- ranking fusion
- result explanations

## Success Criteria

A successful phase 1 must:
- index multiple repositories locally
- search the 10GB repository fast enough for interactive Copilot use
- allow GitHub Copilot to call MCP tools and fetch source ranges
- keep architecture extensible for hybrid retrieval later