import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { CodeAtlasConfig } from "../../../core/src/configuration/config.js";
import {
  findSymbolSchema,
  getIndexStatusSchema,
  readSourceSchema,
  refreshRepoSchema,
  registerRepoSchema,
  searchRequestSchema,
} from "./tool-contracts.js";
import type { createHandlers } from "./handlers.js";

export function createCodeAtlasMcpServer(
  config: CodeAtlasConfig,
  handlers: ReturnType<typeof createHandlers>,
): McpServer {
  const server = new McpServer({
    name: config.mcp.serverName,
    version: config.mcp.serverVersion,
  });

  server.tool(
    "list_repos",
    "List locally registered repositories and return their current index status.",
    { title: "List registered repositories", readOnlyHint: true },
    async () => {
      return handlers.listRepos();
    },
  );

  server.tool(
    "register_repo",
    "Register a local repository by name and filesystem path, then prepare its lexical index state.",
    registerRepoSchema,
    { title: "Register repository", readOnlyHint: false, idempotentHint: false },
    async (request) => {
      return handlers.registerRepo(request);
    },
  );

  server.tool(
    "code_search",
    "Search one or more registered repositories using the phase 1 lexical retrieval backend.",
    searchRequestSchema,
    { title: "Code search", readOnlyHint: true },
    async (request) => {
      return handlers.codeSearch(request);
    },
  );

  server.tool(
    "find_symbol",
    "Search locally indexed symbols across registered repositories using the phase 2 symbol-aware retrieval path.",
    findSymbolSchema,
    { title: "Find symbol", readOnlyHint: true },
    async (request) => {
      return handlers.findSymbol(request);
    },
  );

  server.tool(
    "semantic_search",
    "Reserved stable contract for future local semantic retrieval across registered repositories.",
    searchRequestSchema,
    { title: "Semantic search", readOnlyHint: true },
    async (request) => {
      return handlers.semanticSearch(request);
    },
  );

  server.tool(
    "hybrid_search",
    "Reserved stable contract for future hybrid lexical and semantic retrieval across registered repositories.",
    searchRequestSchema,
    { title: "Hybrid search", readOnlyHint: true },
    async (request) => {
      return handlers.hybridSearch(request);
    },
  );

  server.tool(
    "read_source",
    "Read a line range from a file inside a registered repository using a repository-relative path.",
    readSourceSchema,
    { title: "Read source", readOnlyHint: true },
    async (request) => {
      return handlers.readSource(request);
    },
  );

  server.tool(
    "get_index_status",
    "Return the current local index readiness state for one repository or all registered repositories.",
    getIndexStatusSchema,
    { title: "Get index status", readOnlyHint: true },
    async (request) => {
      return handlers.getIndexStatus(request);
    },
  );

  server.tool(
    "refresh_repo",
    "Refresh lexical index readiness for a single registered repository without rebuilding other repositories.",
    refreshRepoSchema,
    { title: "Refresh repository", readOnlyHint: false, idempotentHint: true },
    async (request) => {
      return handlers.refreshRepo(request);
    },
  );

  return server;
}