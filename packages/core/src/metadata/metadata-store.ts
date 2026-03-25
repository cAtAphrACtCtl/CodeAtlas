export type IndexState = "not_indexed" | "indexing" | "ready" | "stale" | "error";

export interface RepositoryIndexStatus {
  repo: string;
  backend: string;
  configuredBackend?: string;
  state: IndexState;
  lastIndexedAt?: string;
  symbolState?: IndexState;
  symbolLastIndexedAt?: string;
  symbolCount?: number;
  detail?: string;
}

export interface MetadataStore {
  listIndexStatuses(): Promise<RepositoryIndexStatus[]>;
  getIndexStatus(repo: string): Promise<RepositoryIndexStatus | null>;
  setIndexStatus(status: RepositoryIndexStatus): Promise<void>;
}
