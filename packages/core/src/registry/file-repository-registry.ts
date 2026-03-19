import { stat } from "node:fs/promises";
import path from "node:path";

import { CodeAtlasError } from "../common/errors.js";
import { readJsonFile, writeJsonFile } from "../common/json-file.js";
import {
  type RepositoryRecord,
  type RepositoryRegistration,
  type RepositoryRegistry,
} from "./repository-registry.js";

interface RegistryDocument {
  repositories: RepositoryRecord[];
}

export class FileRepositoryRegistry implements RepositoryRegistry {
  constructor(private readonly registryPath: string) {}

  async listRepositories(): Promise<RepositoryRecord[]> {
    const document = await this.readDocument();
    return [...document.repositories].sort((left, right) => left.name.localeCompare(right.name));
  }

  async getRepository(name: string): Promise<RepositoryRecord | null> {
    const repositories = await this.listRepositories();
    return repositories.find((repository) => repository.name === name) ?? null;
  }

  async registerRepository(input: RepositoryRegistration): Promise<RepositoryRecord> {
    const rootPath = path.resolve(input.rootPath);
    const stats = await stat(rootPath);

    if (!stats.isDirectory()) {
      throw new CodeAtlasError(`Repository path is not a directory: ${rootPath}`);
    }

    const document = await this.readDocument();
    const existing = document.repositories.find((repository) => repository.name === input.name);

    if (existing) {
      throw new CodeAtlasError(`Repository already registered: ${input.name}`);
    }

    const record: RepositoryRecord = {
      ...input,
      rootPath,
      registeredAt: new Date().toISOString(),
    };

    document.repositories.push(record);
    await writeJsonFile(this.registryPath, document);

    return record;
  }

  private async readDocument(): Promise<RegistryDocument> {
    return readJsonFile<RegistryDocument>(this.registryPath, { repositories: [] });
  }
}