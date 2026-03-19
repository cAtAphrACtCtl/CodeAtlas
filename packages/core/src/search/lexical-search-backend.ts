import type { RepositoryIndexStatus } from "../metadata/metadata-store.js";
import type { RepositoryRecord } from "../registry/repository-registry.js";

export interface BackendSearchRequest {
  query: string;
  limit: number;
}

export interface BackendSearchHit {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
}

export interface LexicalSearchBackend {
  readonly kind: string;
  prepareRepository(repository: RepositoryRecord): Promise<RepositoryIndexStatus>;
  searchRepository(repository: RepositoryRecord, request: BackendSearchRequest): Promise<BackendSearchHit[]>;
}