import { CodeAtlasError } from "../common/errors.js";
import type { MetadataStore, RepositoryIndexStatus } from "../metadata/metadata-store.js";
import type { RepositoryRegistry } from "../registry/repository-registry.js";
import type { LexicalSearchBackend } from "../search/lexical-search-backend.js";
import { TypeScriptSymbolExtractor } from "../search/symbol-extractor.js";
import type { SymbolIndexStore } from "../search/symbol-index-store.js";

export class IndexCoordinator {
  constructor(
    private readonly registry: RepositoryRegistry,
    private readonly metadataStore: MetadataStore,
    private readonly lexicalBackend: LexicalSearchBackend,
    private readonly symbolExtractor: TypeScriptSymbolExtractor,
    private readonly symbolIndexStore: SymbolIndexStore,
  ) {}

  async ensureReady(repoName: string): Promise<RepositoryIndexStatus> {
    const existing = await this.metadataStore.getIndexStatus(repoName);
    if (existing?.state === "ready" && existing.symbolState === "ready") {
      return existing;
    }

    return this.refreshRepository(repoName);
  }

  async refreshRepository(repoName: string): Promise<RepositoryIndexStatus> {
    const repository = await this.registry.getRepository(repoName);
    if (!repository) {
      throw new CodeAtlasError(`Unknown repository: ${repoName}`);
    }

    const lexicalStatus = await this.lexicalBackend.prepareRepository(repository);
    const indexedAt = new Date().toISOString();
    let status: RepositoryIndexStatus = {
      ...lexicalStatus,
      symbolState: "ready",
      symbolLastIndexedAt: indexedAt,
      symbolCount: 0,
    };

    try {
      const symbols = await this.symbolExtractor.extractRepository(repository);
      await this.symbolIndexStore.setSymbols(repository.name, symbols);
      status = {
        ...status,
        symbolState: "ready",
        symbolLastIndexedAt: indexedAt,
        symbolCount: symbols.length,
      };
    } catch (error) {
      status = {
        ...status,
        symbolState: "error",
        symbolLastIndexedAt: indexedAt,
        detail: lexicalStatus.detail
          ? `${lexicalStatus.detail}; symbol indexing failed: ${String(error)}`
          : `symbol indexing failed: ${String(error)}`,
      };
    }

    await this.metadataStore.setIndexStatus(status);
    return status;
  }

  async getStatus(repoName?: string): Promise<RepositoryIndexStatus[]> {
    if (repoName) {
      const existing = await this.metadataStore.getIndexStatus(repoName);
      if (existing) {
        return [existing];
      }

      return [
        {
          repo: repoName,
          backend: this.lexicalBackend.kind,
          state: "not_indexed",
        },
      ];
    }

    const repositories = await this.registry.listRepositories();
    const statuses = await this.metadataStore.listIndexStatuses();
    const statusMap = new Map(statuses.map((status) => [status.repo, status]));

    return repositories.map((repository) => {
      return (
        statusMap.get(repository.name) ?? {
          repo: repository.name,
          backend: this.lexicalBackend.kind,
          state: "not_indexed",
        }
      );
    });
  }
}