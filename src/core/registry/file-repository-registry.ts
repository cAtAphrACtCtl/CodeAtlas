import { stat } from "node:fs/promises";
import path from "node:path";

import { toErrorDetails } from "../common/debug.js";
import { CodeAtlasError } from "../common/errors.js";
import { readJsonFile, writeJsonFile } from "../common/json-file.js";
import { getLogger, type Logger } from "../logging/logger.js";
import type {
	RepositoryRecord,
	RepositoryRegistration,
	RepositoryRegistry,
} from "./repository-registry.js";

interface RegistryDocument {
	repositories: RepositoryRecord[];
}

export class FileRepositoryRegistry implements RepositoryRegistry {
	private readonly logger: Logger | undefined;

	constructor(private readonly registryPath: string) {
		this.logger = getLogger();
	}

	private logDebug(message: string, details?: Record<string, unknown>): void {
		this.logger?.debug("registry", message, { details });
	}

	async listRepositories(): Promise<RepositoryRecord[]> {
		const document = await this.readDocument();
		const repositories = [...document.repositories].sort((left, right) =>
			left.name.localeCompare(right.name),
		);
		this.logDebug("listed repositories", {
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
		this.logDebug("registering repository", {
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

		this.logDebug("registered repository", {
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
			this.logDebug("loaded registry document", {
				registryPath: this.registryPath,
				repositoryCount: document.repositories.length,
			});
			return document;
		} catch (error) {
			this.logDebug("failed to read registry document", {
				registryPath: this.registryPath,
				...toErrorDetails(error),
			});
			throw error;
		}
	}
}
