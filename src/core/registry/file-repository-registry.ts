import { stat } from "node:fs/promises";
import path from "node:path";

import { toErrorDetails } from "../common/debug.js";
import { CodeAtlasError } from "../common/errors.js";
import { readJsonFile, writeJsonFile } from "../common/json-file.js";
import { getRepoIndexDir } from "../indexer/repo-artifact-path.js";
import { getLogger, type Logger } from "../logging/logger.js";
import { getSymbolIndexPath } from "../search/symbol-index-store.js";
import type {
	RepositoryRecord,
	RepositoryRegistration,
	RepositoryRegistry,
} from "./repository-registry.js";

interface RegistryDocument {
	repositories: RepositoryRecord[];
}

export interface FileRepositoryRegistryOptions {
	lexicalIndexRoot?: string;
	symbolIndexRoot?: string;
}

export class FileRepositoryRegistry implements RepositoryRegistry {
	private readonly logger: Logger | undefined;

	constructor(
		private readonly registryPath: string,
		private readonly options: FileRepositoryRegistryOptions = {},
	) {
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
		const normalizedRecord = this.withDerivedIndexPaths(record);

		document.repositories.push(normalizedRecord);
		await writeJsonFile(this.registryPath, document);

		this.logDebug("registered repository", {
			name: normalizedRecord.name,
			rootPath: normalizedRecord.rootPath,
			lexicalIndexPath: normalizedRecord.lexicalIndexPath,
			symbolIndexPath: normalizedRecord.symbolIndexPath,
			repositoryCount: document.repositories.length,
		});

		return normalizedRecord;
	}

	async unregisterRepository(name: string): Promise<RepositoryRecord | null> {
		const document = await this.readDocument();
		const index = document.repositories.findIndex(
			(repository) => repository.name === name,
		);

		if (index < 0) {
			this.logDebug("repository not found during unregister", {
				name,
				registryPath: this.registryPath,
			});
			return null;
		}

		const [removed] = document.repositories.splice(index, 1);
		await writeJsonFile(this.registryPath, document);

		this.logDebug("unregistered repository", {
			name: removed.name,
			rootPath: removed.rootPath,
			repositoryCount: document.repositories.length,
		});

		return removed;
	}

	private async readDocument(): Promise<RegistryDocument> {
		try {
			const document = await readJsonFile<RegistryDocument>(this.registryPath, {
				repositories: [],
			});
			const normalizedDocument = this.normalizeDocument(document);
			if (normalizedDocument.changed) {
				await writeJsonFile(this.registryPath, normalizedDocument.document);
			}
			this.logDebug("loaded registry document", {
				registryPath: this.registryPath,
				repositoryCount: normalizedDocument.document.repositories.length,
			});
			return normalizedDocument.document;
		} catch (error) {
			this.logDebug("failed to read registry document", {
				registryPath: this.registryPath,
				...toErrorDetails(error),
			});
			throw error;
		}
	}

	private normalizeDocument(document: RegistryDocument): {
		document: RegistryDocument;
		changed: boolean;
	} {
		let changed = false;
		const repositories = document.repositories.map((repository) => {
			const normalized = this.withDerivedIndexPaths(repository);
			if (
				normalized.lexicalIndexPath !== repository.lexicalIndexPath ||
				normalized.symbolIndexPath !== repository.symbolIndexPath
			) {
				changed = true;
			}
			return normalized;
		});

		return {
			document: changed ? { repositories } : document,
			changed,
		};
	}

	private withDerivedIndexPaths(repository: RepositoryRecord): RepositoryRecord {
		const lexicalIndexPath = this.options.lexicalIndexRoot
			? getRepoIndexDir(
				this.options.lexicalIndexRoot,
				repository.name,
				repository.rootPath,
			)
			: undefined;
		const symbolIndexPath = this.options.symbolIndexRoot
			? getSymbolIndexPath(this.options.symbolIndexRoot, repository.name)
			: undefined;

		return {
			...repository,
			lexicalIndexPath,
			symbolIndexPath,
		};
	}
}
