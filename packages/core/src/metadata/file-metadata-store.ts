import { debugLog, toErrorDetails } from "../common/debug.js";
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
    const statuses = [...document.statuses].sort((left, right) => left.repo.localeCompare(right.repo));
    debugLog("metadata", "listed index statuses", {
      metadataPath: this.metadataPath,
      statusCount: statuses.length,
    });
    return statuses;
  }

  async getIndexStatus(repo: string): Promise<RepositoryIndexStatus | null> {
    const document = await this.readDocument();
    const status = document.statuses.find((candidate) => candidate.repo === repo) ?? null;
    debugLog("metadata", "read index status", {
      metadataPath: this.metadataPath,
      repo,
      found: Boolean(status),
    });
    return status;
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
    debugLog("metadata", "stored index status", {
      metadataPath: this.metadataPath,
      repo: status.repo,
      backend: status.backend,
      configuredBackend: status.configuredBackend,
      state: status.state,
      symbolState: status.symbolState,
    });
  }

  private async readDocument(): Promise<MetadataDocument> {
    try {
      const document = await readJsonFile<MetadataDocument>(this.metadataPath, { statuses: [] });
      debugLog("metadata", "loaded metadata document", {
        metadataPath: this.metadataPath,
        statusCount: document.statuses.length,
      });
      return document;
    } catch (error) {
      debugLog("metadata", "failed to read metadata document", {
        metadataPath: this.metadataPath,
        ...toErrorDetails(error),
      });
      throw error;
    }
  }
}
