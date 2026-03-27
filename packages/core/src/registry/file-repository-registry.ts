import { stat } from "node:fs/promises";
import path from "node:path";

import { debugLog, toErrorDetails } from "../common/debug.js";
import { CodeAtlasError } from "../common/errors.js";
import { readJsonFile, writeJsonFile } from "../common/json-file.js";
import type {
	RepositoryRecord,
	RepositoryRegistration,
	RepositoryRegistry,
} from "./repository-registry.js";

interface RegistryDocument {
	repositories: RepositoryRecord[];
}

export class FileRepositoryRegistry implements RepositoryRegistry {
	constructor(private readonly registryPath: string) {}

	async listRepositories(): Promise<RepositoryRecord[]> {
		const document = await this.readDocument();
		const repositories = [...document.repositories].sort((left, right) =>
			left.name.localeCompare(right.name),
		);
		debugLog("registry", "listed repositories", {
			registryPath: this.registryPath,
			repositoryCount: repositories.length,
		});
		return repositories;
	}

	async getRepository(name: string): Promise<RepositoryRecord | null> {
		const repositories = await this.listRepositories();
		return repositories.find((repository) => repository.name === name) ?? null;
	}

	async registerRepository(
		input: RepositoryRegistration,
	): Promise<RepositoryRecord> {
		const rootPath = path.resolve(input.rootPath);
		debugLog("registry", "registering repository", {
			name: input.name,
			rootPath,
			branch: input.branch,
			registryPath: this.registryPath,
		});
		const stats = await stat(rootPath);

		if (!stats.isDirectory()) {
			throw new CodeAtlasError(
				`Repository path is not a directory: ${rootPath}`,
			);
		}

		const document = await this.readDocument();
		const existing = document.repositories.find(
			(repository) => repository.name === input.name,
		);

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

		debugLog("registry", "registered repository", {
			name: record.name,
			rootPath: record.rootPath,
			repositoryCount: document.repositories.length,
		});

		return record;
	}

	private async readDocument(): Promise<RegistryDocument> {
		try {
			const document = await readJsonFile<RegistryDocument>(this.registryPath, {
				repositories: [],
			});
			debugLog("registry", "loaded registry document", {
				registryPath: this.registryPath,
				repositoryCount: document.repositories.length,
			});
			return document;
		} catch (error) {
			debugLog("registry", "failed to read registry document", {
				registryPath: this.registryPath,
				...toErrorDetails(error),
			});
			throw error;
		}
	}
}
