export type IndexState = "not_indexed" | "ready" | "error";

export interface RepositoryIndexStatus {
  repo: string;
  backend: string;
  state: IndexState;
  lastIndexedAt?: string;
  detail?: string;
}

export interface MetadataStore {
  listIndexStatuses(): Promise<RepositoryIndexStatus[]>;
  getIndexStatus(repo: string): Promise<RepositoryIndexStatus | null>;
  setIndexStatus(status: RepositoryIndexStatus): Promise<void>;
}