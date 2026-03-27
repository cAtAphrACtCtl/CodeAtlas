import { debugLog, toErrorDetails } from "../common/debug.js";
import { CodeAtlasError } from "../common/errors.js";
import type {
	MetadataStore,
	RepositoryIndexStatus,
} from "../metadata/metadata-store.js";
import type { RepositoryRegistry } from "../registry/repository-registry.js";
import type { LexicalSearchBackend } from "../search/lexical-search-backend.js";
import type { TypeScriptSymbolExtractor } from "../search/symbol-extractor.js";
import type { SymbolIndexStore } from "../search/symbol-index-store.js";

export class IndexCoordinator {
	private readonly inFlightRefreshes = new Map<
		string,
		Promise<RepositoryIndexStatus>
	>();

	constructor(
		private readonly registry: RepositoryRegistry,
		private readonly metadataStore: MetadataStore,
		private readonly lexicalBackend: LexicalSearchBackend,
		private readonly symbolExtractor: TypeScriptSymbolExtractor,
		private readonly symbolIndexStore: SymbolIndexStore,
	) {}

	async ensureReady(repoName: string): Promise<RepositoryIndexStatus> {
		return this.ensureSymbolReady(repoName);
	}

	async ensureLexicalReady(repoName: string): Promise<RepositoryIndexStatus> {
		debugLog("indexer", "ensuring lexical readiness", {
			repo: repoName,
		});
		const existing = await this.metadataStore.getIndexStatus(repoName);
		if (existing?.state === "ready") {
			const verified = await this.validateStoredLexicalReadyStatus(
				repoName,
				existing,
			);
			if (verified) {
				return verified;
			}
		}

		const inFlight = this.inFlightRefreshes.get(repoName);
		if (inFlight) {
			debugLog("indexer", "reusing in-flight lexical refresh", {
				repo: repoName,
			});
			return inFlight;
		}

		return this.refreshRepository(repoName);
	}

	async ensureSymbolReady(repoName: string): Promise<RepositoryIndexStatus> {
		debugLog("indexer", "ensuring symbol readiness", {
			repo: repoName,
		});
		const existing = await this.metadataStore.getIndexStatus(repoName);
		if (existing?.state === "ready" && existing.symbolState === "ready") {
			const verified = await this.validateStoredLexicalReadyStatus(
				repoName,
				existing,
			);
			if (verified) {
				return verified;
			}
		}

		const inFlight = this.inFlightRefreshes.get(repoName);
		if (inFlight) {
			debugLog("indexer", "reusing in-flight symbol refresh", {
				repo: repoName,
			});
			return inFlight;
		}

		return this.refreshRepository(repoName);
	}

	async refreshRepository(repoName: string): Promise<RepositoryIndexStatus> {
		debugLog("indexer", "requesting repository refresh", {
			repo: repoName,
		});
		const existingRefresh = this.inFlightRefreshes.get(repoName);
		if (existingRefresh) {
			debugLog("indexer", "returning existing in-flight refresh", {
				repo: repoName,
			});
			return existingRefresh;
		}

		const refreshPromise = this.refreshRepositoryInternal(repoName);
		this.inFlightRefreshes.set(repoName, refreshPromise);

		try {
			return await refreshPromise;
		} finally {
			if (this.inFlightRefreshes.get(repoName) === refreshPromise) {
				this.inFlightRefreshes.delete(repoName);
			}
		}
	}

	async markRepositoryStale(
		repoName: string,
		detail = "Repository contents changed and require refresh",
	): Promise<RepositoryIndexStatus> {
		debugLog("indexer", "marking repository stale", {
			repo: repoName,
			detail,
		});
		const repository = await this.registry.getRepository(repoName);
		if (!repository) {
			throw new CodeAtlasError(`Unknown repository: ${repoName}`);
		}

		const existing = await this.metadataStore.getIndexStatus(repoName);
		const status: RepositoryIndexStatus = {
			repo: repository.name,
			backend: existing?.backend ?? this.lexicalBackend.kind,
			configuredBackend:
				existing?.configuredBackend ?? this.lexicalBackend.kind,
			state: "stale",
			reason: "repository_stale",
			lastIndexedAt: existing?.lastIndexedAt,
			symbolState:
				existing?.symbolState === "not_indexed" ||
				existing?.symbolState === undefined
					? existing?.symbolState
					: "stale",
			symbolLastIndexedAt: existing?.symbolLastIndexedAt,
			symbolCount: existing?.symbolCount,
			detail,
		};

		await this.metadataStore.setIndexStatus(status);
		debugLog("indexer", "stored stale repository status", {
			repo: repoName,
			backend: status.backend,
			configuredBackend: status.configuredBackend,
			state: status.state,
			symbolState: status.symbolState,
		});
		return status;
	}

	private async validateStoredLexicalReadyStatus(
		repoName: string,
		existing: RepositoryIndexStatus,
	): Promise<RepositoryIndexStatus | null> {
		if (!this.lexicalBackend.verifyRepositoryReady) {
			return existing;
		}

		const repository = await this.registry.getRepository(repoName);
		if (!repository) {
			return existing;
		}

		let readiness: {
			ready: boolean;
			state?: "stale" | "error";
			reason?: RepositoryIndexStatus["reason"];
			detail?: string;
		};
		try {
			readiness = await this.lexicalBackend.verifyRepositoryReady(
				repository,
				existing,
			);
		} catch (error) {
			debugLog("indexer", "lexical readiness verification threw", {
				repo: repoName,
				...toErrorDetails(error),
			});
			readiness = {
				ready: false,
				state: "error" as const,
				reason: "lexical_readiness_verification_failed",
				detail: `Lexical readiness verification failed: ${String(error)}`,
			};
		}

		if (readiness.ready) {
			debugLog("indexer", "stored lexical status verified ready", {
				repo: repoName,
				backend: existing.backend,
				configuredBackend: existing.configuredBackend,
			});
			return existing;
		}

		debugLog("indexer", "stored lexical status is no longer ready", {
			repo: repoName,
			backend: existing.backend,
			configuredBackend: existing.configuredBackend,
			nextState: readiness.state ?? "stale",
			detail: readiness.detail,
		});

		await this.metadataStore.setIndexStatus({
			...existing,
			backend: existing.backend || this.lexicalBackend.kind,
			configuredBackend: existing.configuredBackend ?? this.lexicalBackend.kind,
			state: readiness.state ?? "stale",
			reason: readiness.reason,
			detail: readiness.detail ?? existing.detail,
		});

		return null;
	}

	private async refreshRepositoryInternal(
		repoName: string,
	): Promise<RepositoryIndexStatus> {
		debugLog("indexer", "starting refreshRepositoryInternal", {
			repo: repoName,
		});
		const repository = await this.registry.getRepository(repoName);
		if (!repository) {
			throw new CodeAtlasError(`Unknown repository: ${repoName}`);
		}

		const existing = await this.metadataStore.getIndexStatus(repoName);
		await this.metadataStore.setIndexStatus({
			repo: repository.name,
			backend: existing?.backend ?? this.lexicalBackend.kind,
			configuredBackend: this.lexicalBackend.kind,
			state: "indexing",
			reason: "refresh_in_progress",
			lastIndexedAt: existing?.lastIndexedAt,
			symbolState: "indexing",
			symbolLastIndexedAt: existing?.symbolLastIndexedAt,
			symbolCount: existing?.symbolCount,
			detail: "Repository refresh in progress",
		});

		debugLog("indexer", "stored indexing status", {
			repo: repository.name,
			configuredBackend: this.lexicalBackend.kind,
		});

		const lexicalStatus =
			await this.lexicalBackend.prepareRepository(repository);
		debugLog("indexer", "lexical refresh completed", {
			repo: repository.name,
			backend: lexicalStatus.backend,
			state: lexicalStatus.state,
			detail: lexicalStatus.detail,
		});
		const indexedAt = new Date().toISOString();
		let status: RepositoryIndexStatus = {
			...lexicalStatus,
			configuredBackend: this.lexicalBackend.kind,
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
			debugLog("indexer", "symbol extraction completed", {
				repo: repository.name,
				symbolCount: symbols.length,
			});
		} catch (error) {
			debugLog("indexer", "symbol extraction failed", {
				repo: repository.name,
				...toErrorDetails(error),
			});
			status = {
				...status,
				symbolState: "error",
				reason: lexicalStatus.reason ?? "symbol_index_failed",
				symbolLastIndexedAt: indexedAt,
				detail: lexicalStatus.detail
					? `${lexicalStatus.detail}; symbol indexing failed: ${String(error)}`
					: `symbol indexing failed: ${String(error)}`,
			};
		}

		await this.metadataStore.setIndexStatus(status);
		debugLog("indexer", "stored final repository status", {
			repo: repository.name,
			backend: status.backend,
			configuredBackend: status.configuredBackend,
			state: status.state,
			symbolState: status.symbolState,
			detail: status.detail,
		});
		return status;
	}

	async getStatus(repoName?: string): Promise<RepositoryIndexStatus[]> {
		debugLog("indexer", "reading index status", {
			repo: repoName,
		});
		if (repoName) {
			const existing = await this.metadataStore.getIndexStatus(repoName);
			if (existing) {
				return [existing];
			}

			return [
				{
					repo: repoName,
					backend: this.lexicalBackend.kind,
					configuredBackend: this.lexicalBackend.kind,
					state: "not_indexed",
					symbolState: "not_indexed",
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
					configuredBackend: this.lexicalBackend.kind,
					state: "not_indexed",
					symbolState: "not_indexed",
				}
			);
		});
	}
}
