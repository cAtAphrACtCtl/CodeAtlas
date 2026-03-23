import type { ReadSourceRequest, SearchRequest, SymbolSearchRequest } from "../../../core/src/contracts/search.js";
import type { IndexCoordinator } from "../../../core/src/indexer/index-coordinator.js";
import type { MetadataStore } from "../../../core/src/metadata/metadata-store.js";
import type { SourceReader } from "../../../core/src/reader/source-reader.js";
import type { RepositoryRegistry } from "../../../core/src/registry/repository-registry.js";
import type { SearchService } from "../../../core/src/search/search-service.js";

export interface HandlerDependencies {
  registry: RepositoryRegistry;
  metadataStore: MetadataStore;
  indexCoordinator: IndexCoordinator;
  searchService: SearchService;
  sourceReader: SourceReader;
}

function toToolResult<T extends object>(payload: T) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload as Record<string, unknown>,
  };
}

export function createHandlers(dependencies: HandlerDependencies) {
  return {
    listRepos: async () => {
      const repositories = await dependencies.registry.listRepositories();
      const statuses = await dependencies.indexCoordinator.getStatus();

      return toToolResult({
        repositories,
        index_status: statuses,
      });
    },

    registerRepo: async (request: { name: string; root_path: string; branch?: string }) => {
      const repository = await dependencies.registry.registerRepository({
        name: request.name,
        rootPath: request.root_path,
        branch: request.branch,
      });

      const status = await dependencies.indexCoordinator.refreshRepository(repository.name);

      return toToolResult({
        repository,
        index_status: status,
      });
    },

    codeSearch: async (request: SearchRequest) => {
      const response = await dependencies.searchService.searchLexical(request);
      return toToolResult(response);
    },

    findSymbol: async (request: SymbolSearchRequest) => {
      const response = await dependencies.searchService.findSymbols(request);
      return toToolResult(response);
    },

    semanticSearch: async (request: SearchRequest) => {
      const response = await dependencies.searchService.searchSemantic(request);
      return toToolResult(response);
    },

    hybridSearch: async (request: SearchRequest) => {
      const response = await dependencies.searchService.searchHybrid(request);
      return toToolResult(response);
    },

    readSource: async (request: ReadSourceRequest) => {
      const repository = await dependencies.registry.getRepository(request.repo);
      if (!repository) {
        throw new Error(`Unknown repository: ${request.repo}`);
      }

      const response = await dependencies.sourceReader.readRange(
        repository,
        request.path,
        request.start_line,
        request.end_line,
      );

      return toToolResult(response);
    },

    getIndexStatus: async (request: { repo?: string }) => {
      const statuses = await dependencies.indexCoordinator.getStatus(request.repo);
      return toToolResult({
        index_status: statuses,
      });
    },

    refreshRepo: async (request: { repo: string }) => {
      const status = await dependencies.indexCoordinator.refreshRepository(request.repo);
      return toToolResult({
        index_status: status,
      });
    },
  };
}