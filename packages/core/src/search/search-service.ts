import type { CodeAtlasConfig } from "../configuration/config.js";
import { CodeAtlasError } from "../common/errors.js";
import type {
  SearchRequest,
  SearchResponse,
  SearchResult,
  SymbolSearchRequest,
  SymbolSearchResponse,
} from "../contracts/search.js";
import type { IndexCoordinator } from "../indexer/index-coordinator.js";
import type { RepositoryRecord, RepositoryRegistry } from "../registry/repository-registry.js";
import type { LexicalSearchBackend } from "./lexical-search-backend.js";
import { SymbolSearchBackend, scoreSymbol } from "./symbol-search-backend.js";

export class SearchService {
  constructor(
    private readonly registry: RepositoryRegistry,
    private readonly indexCoordinator: IndexCoordinator,
    private readonly lexicalBackend: LexicalSearchBackend,
    private readonly symbolSearchBackend: SymbolSearchBackend,
    private readonly searchConfig: CodeAtlasConfig["search"],
  ) {}

  async searchLexical(request: SearchRequest): Promise<SearchResponse> {
    const repositories = await this.resolveRepositories(request.repos);
    const limit = this.resolveLimit(request.limit);

    await Promise.all(repositories.map((repository) => this.indexCoordinator.ensureReady(repository.name)));

    const searchResults = await Promise.all(
      repositories.map((repository) => this.lexicalBackend.searchRepository(repository, { query: request.query, limit })),
    );

    const results: SearchResult[] = searchResults
      .flatMap((hits, repositoryIndex) => {
        const repository = repositories[repositoryIndex];
        return hits.map((hit) => ({
          repo: repository.name,
          path: hit.path,
          start_line: hit.startLine,
          end_line: hit.endLine,
          snippet: hit.snippet,
          score: hit.score,
          source_type: "lexical" as const,
        }));
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    return {
      query: request.query,
      source_type: "lexical",
      results,
    };
  }

  async searchSemantic(request: SearchRequest): Promise<SearchResponse> {
    return {
      query: request.query,
      source_type: "semantic",
      results: [],
      not_implemented: true,
      message: "TODO: semantic_search will attach a local chunking and embedding pipeline behind the existing MCP contract.",
    };
  }

  async searchHybrid(request: SearchRequest): Promise<SearchResponse> {
    return {
      query: request.query,
      source_type: "hybrid",
      results: [],
      not_implemented: true,
      message: "TODO: hybrid_search will merge lexical and semantic candidates without changing the MCP tool contract.",
    };
  }

  async findSymbols(request: SymbolSearchRequest): Promise<SymbolSearchResponse> {
    const repositories = await this.resolveRepositories(request.repos);
    const limit = this.resolveLimit(request.limit);

    await Promise.all(repositories.map((repository) => this.indexCoordinator.ensureReady(repository.name)));

    const results = await Promise.all(
      repositories.map((repository) =>
        this.symbolSearchBackend.searchRepository(repository.name, {
          ...request,
          limit,
        }),
      ),
    );

    return {
      query: request.query,
      results: results
        .flat()
        .sort((left, right) => scoreSymbol(right, request.query, request.exact ?? false) - scoreSymbol(left, request.query, request.exact ?? false))
        .slice(0, limit),
    };
  }

  private async resolveRepositories(repoNames?: string[]): Promise<RepositoryRecord[]> {
    if (!repoNames || repoNames.length === 0) {
      return this.registry.listRepositories();
    }

    const repositories = await Promise.all(repoNames.map((repoName) => this.registry.getRepository(repoName)));
    const missingRepositories = repoNames.filter((_, index) => !repositories[index]);

    if (missingRepositories.length > 0) {
      throw new CodeAtlasError(`Unknown repositories: ${missingRepositories.join(", ")}`);
    }

    return repositories as RepositoryRecord[];
  }

  private resolveLimit(limit?: number): number {
    const requestedLimit = limit ?? this.searchConfig.defaultLimit;
    return Math.min(Math.max(requestedLimit, 1), this.searchConfig.maxLimit);
  }
}