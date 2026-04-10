# CodeAtlas MCP API Documentation

CodeAtlas exposes its capabilities via the Model Context Protocol (MCP). The API is divided into three main logical groups: **Repository Lifecycle**, **Index Control**, and **Search & Retrieval**.

All endpoints are exposed as MCP Tools.

---

## 1. Repository Lifecycle Tools

These tools manage the local registry of repositories that CodeAtlas knows about.

### `list_repos`
Lists all locally registered repositories and their current index statuses.
- **Parameters**: None.
- **Returns**: A list of repositories including their logical name, root path, branch, and current index status (e.g., `not_indexed`, `indexing`, `ready`, `stale`, `error`).

### `register_repo`
Registers a new repository for CodeAtlas to track and index.
- **Parameters**:
  - `name` (string, required): The logical name of the repository (e.g., `"CargoWise"`).
  - `root_path` (string, required): The absolute local file system path to the repository root.
  - `branch` (string, optional): The branch name to associate with the repository.

### `unregister_repo`
Removes a repository from the CodeAtlas registry and optionally cleans up its indexed data.
- **Parameters**:
  - `repo` (string, required): The logical name of the repository to unregister.
  - `purge_index` (boolean, optional): If true, physically deletes the repository's index artifacts from disk.
  - `purge_metadata` (boolean, optional): If true, deletes the repository's status tracking metadata.

---

## 2. Index Control Tools

These tools manage the state and maintenance of the underlying search indexes (primarily Zoekt and related metadata).

### `refresh_repo`
Triggers an asynchronous rebuild or update of the repository's index. This is a request-driven operation; CodeAtlas does not auto-index in the background.
- **Parameters**:
  - `repo` (string, required): The logical name of the repository to refresh.

### `get_index_status`
Retrieves detailed status and diagnostic information about the index for a specific repository or all repositories.
- **Parameters**:
  - `repo` (string, optional): The logical name of the repository. If omitted, returns statuses for all registered repositories.

### `delete_index`
Deletes specific index artifacts for a repository to help recover from corrupted states.
- **Parameters**:
  - `repo` (string, required): The logical name of the repository.
  - `target` (enum: `"lexical" | "symbol" | "all"`, optional): The specific index layer to delete.

---

## 3. Search & Retrieval Tools

These tools are the primary queries used by agents to search code and read files.

### `code_search`
Performs a fast, lexical substring or regex search across one or more repositories using the primary configured backend (typically Zoekt).
- **Parameters**:
  - `query` (string, required): The search string or regex pattern.
  - `repos` (string array, optional): Specific repository names to narrow the search.
  - `limit` (number, optional): Maximum number of results to return.

### `find_symbol`
Searches for specific symbols (classes, functions, types, etc.). Currently runs as a lexical-first query with snippet-based inference rather than relying strictly on the extracted AST symbol index.
- **Parameters**:
  - `query` (string, required): The symbol name or substring to search for.
  - `repos` (string array, optional): Specific repository names to narrow the search.
  - `kinds` (enum array, optional): Filter by symbol types (`"class"`, `"enum"`, `"function"`, `"interface"`, `"method"`, `"property"`, `"type_alias"`, `"variable"`).
  - `limit` (number, optional): Maximum number of results to return.
  - `exact` (boolean, optional): If true, enforces an exact case-insensitive match on the symbol name.

### `read_source`
Reads specific lines from a file in a registered repository. Required for an agent to inspect the precise context of a search result.
- **Parameters**:
  - `repo` (string, required): The logical name of the repository.
  - `path` (string, required): The repository-relative path to the file.
  - `start_line` (number, required): The 1-based line number to start reading from.
  - `end_line` (number, required): The 1-based line number to end reading at.

---

## 4. Reserved Placeholder Tools

These tools define stable MCP contracts for future architectural phases (e.g., semantic retrieval, local embeddings) but currently return empty or placeholder responses. They allow clients to integrate early without breaking when the backend matures.

### `semantic_search`
*(Placeholder)* Will perform semantic vector-based retrieval against chunked code embeddings.

### `hybrid_search`
*(Placeholder)* Will perform a fused query combining both lexical and semantic candidates, with normalized ranking.
