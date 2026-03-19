import { readJsonFile, writeJsonFile } from "../common/json-file.js";
import {
  type MetadataStore,
  type RepositoryIndexStatus,
} from "./metadata-store.js";

interface MetadataDocument {
  statuses: RepositoryIndexStatus[];
}

export class FileMetadataStore implements MetadataStore {
  constructor(private readonly metadataPath: string) {}

  async listIndexStatuses(): Promise<RepositoryIndexStatus[]> {
    const document = await this.readDocument();
    return [...document.statuses].sort((left, right) => left.repo.localeCompare(right.repo));
  }

  async getIndexStatus(repo: string): Promise<RepositoryIndexStatus | null> {
    const document = await this.readDocument();
    return document.statuses.find((status) => status.repo === repo) ?? null;
  }

  async setIndexStatus(status: RepositoryIndexStatus): Promise<void> {
    const document = await this.readDocument();
    const index = document.statuses.findIndex((candidate) => candidate.repo === status.repo);

    if (index >= 0) {
      document.statuses[index] = status;
    } else {
      document.statuses.push(status);
    }

    await writeJsonFile(this.metadataPath, document);
  }

  private async readDocument(): Promise<MetadataDocument> {
    return readJsonFile<MetadataDocument>(this.metadataPath, { statuses: [] });
  }
}