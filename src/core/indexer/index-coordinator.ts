import { toErrorDetails } from "../common/debug.js";
import { CodeAtlasError } from "../common/errors.js";
import type {
	MetadataStore,
	RepositoryIndexStatus,
} from "../metadata/metadata-store.js";
import type { RepositoryRegistry } from "../registry/repository-registry.js";
import type { LexicalSearchBackend } from "../search/lexical-search-backend.js";
import type { TypeScriptSymbolExtractor } from "../search/symbol-extractor.js";
import type { SymbolIndexStore } from "../search/symbol-index-store.js";
import { getLogger, type Logger } from "../logging/logger.js";

export type IndexDeleteTarget = "lexical" | "symbol" | "all";

export interface DeleteIndexResult {
	repo: string;
	removedLexical: boolean;
	removedSymbols: boolean;
	errors?: string[];
}

export interface UnregisterRepositoryResult {
	repositoryRemoved: boolean;
	removedIndexStatus: boolean;
	removedLexical: boolean;
	removedSymbols: boolean;
	errors?: string[];
}

export class IndexCoordinator {
	private readonly inFlightRefreshes = new Map<
		string,
		Promise<RepositoryIndexStatus>
	>();
	private readonly logger: Logger | undefined;

	constructor(
		private readonly registry: RepositoryRegistry,
		private readonly metadataStore: MetadataStore,
		private readonly lexicalBackend: LexicalSearchBackend,
		private readonly symbolExtractor: TypeScriptSymbolExtractor,
		private readonly symbolIndexStore: SymbolIndexStore,
	) {
		this.logger = getLogger();
	}

	private logDebug(message: string, details?: Record<string, unknown>): void {
		this.logger?.debug("indexer", message, { details });
	}

	async ensureReady(repoName: string): Promise<RepositoryIndexStatus> {
		return this.ensureSymbolReady(repoName);
	}

	async ensureLexicalReady(repoName: string): Promise<RepositoryIndexStatus> {
		this.logDebug("ensuring lexical readiness", {
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
			this.logDebug("reusing in-flight lexical refresh", {
				repo: repoName,
			});
			return inFlight;
		}

		return this.refreshRepository(repoName);
	}

	async ensureSymbolReady(repoName: string): Promise<RepositoryIndexStatus> {
		this.logDebug("ensuring symbol readiness", {
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
			this.logDebug("reusing in-flight symbol refresh", {
				repo: repoName,
			});
			return inFlight;
		}

		return this.refreshRepository(repoName);
	}

	async refreshRepository(repoName: string): Promise<RepositoryIndexStatus> {
		this.logDebug("requesting repository refresh", {
			repo: repoName,
		});
		const existingRefresh = this.inFlightRefreshes.get(repoName);
		if (existingRefresh) {
			this.logDebug("returning existing in-flight refresh", {
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

	async deleteRepositoryIndex(
		repoName: string,
		target: IndexDeleteTarget = "all",
	): Promise<DeleteIndexResult> {
		this.assertRefreshNotInFlight(repoName);

		const repository = await this.registry.getRepository(repoName);
		if (!repository) {
			throw new CodeAtlasError(`Unknown repository: ${repoName}`);
		}

		const removeLexical = target === "lexical" || target === "all";
		const removeSymbols = target === "symbol" || target === "all";
		let removedLexical = false;
		let removedSymbols = false;
		const errors: string[] = [];

		if (removeLexical) {
			try {
				await this.lexicalBackend.deleteRepositoryArtifacts?.(repository);
				removedLexical = true;
			} catch (error) {
				errors.push(`lexical cleanup failed: ${String(error)}`);
			}
		}

		if (removeSymbols) {
			try {
				await this.symbolIndexStore.deleteSymbols?.(repository.name);
				removedSymbols = true;
			} catch (error) {
				errors.push(`symbol cleanup failed: ${String(error)}`);
			}
		}

		const existing = await this.metadataStore.getIndexStatus(repoName);
		await this.metadataStore.setIndexStatus({
			repo: repository.name,
			backend: existing?.backend ?? this.lexicalBackend.kind,
			configuredBackend: existing?.configuredBackend ?? this.lexicalBackend.kind,
			state: removedLexical ? "not_indexed" : (existing?.state ?? "not_indexed"),
			symbolState: removedSymbols
				? "not_indexed"
				: (existing?.symbolState ?? "not_indexed"),
			reason: undefined,
			lastIndexedAt: removedLexical ? undefined : existing?.lastIndexedAt,
			symbolLastIndexedAt: removedSymbols
				? undefined
				: existing?.symbolLastIndexedAt,
			symbolCount: removedSymbols ? 0 : existing?.symbolCount,
			detail:
				errors.length === 0
					? `Index cleanup completed (target=${target})`
					: `Index cleanup partially completed (target=${target}): ${errors.join("; ")}`,
		});

		return {
			repo: repoName,
			removedLexical,
			removedSymbols,
			errors: errors.length > 0 ? errors : undefined,
		};
	}

	async unregisterRepository(
		repoName: string,
		options: { purgeIndex?: boolean; purgeMetadata?: boolean } = {},
	): Promise<UnregisterRepositoryResult> {
		this.assertRefreshNotInFlight(repoName);
		if (!this.registry.unregisterRepository) {
			throw new CodeAtlasError(
				"Repository registry does not support unregister operation",
			);
		}

		const purgeIndex = options.purgeIndex ?? false;
		const purgeMetadata = options.purgeMetadata ?? true;
		const existingRepository = await this.registry.getRepository(repoName);
		let removedLexical = false;
		let removedSymbols = false;
		const errors: string[] = [];

		if (existingRepository && purgeIndex) {
			try {
				await this.lexicalBackend.deleteRepositoryArtifacts?.(existingRepository);
				removedLexical = true;
			} catch (error) {
				errors.push(`lexical cleanup failed: ${String(error)}`);
			}
			try {
				await this.symbolIndexStore.deleteSymbols?.(existingRepository.name);
				removedSymbols = true;
			} catch (error) {
				errors.push(`symbol cleanup failed: ${String(error)}`);
			}
		}

		const removedRepository = await this.registry.unregisterRepository(repoName);
		let removedIndexStatus = false;
		if (purgeMetadata && this.metadataStore.deleteIndexStatus) {
			try {
				const removedStatus = await this.metadataStore.deleteIndexStatus(repoName);
				removedIndexStatus = removedStatus !== null;
			} catch (error) {
				errors.push(`metadata cleanup failed: ${String(error)}`);
			}
		}

		return {
			repositoryRemoved: removedRepository !== null,
			removedIndexStatus,
			removedLexical,
			removedSymbols,
			errors: errors.length > 0 ? errors : undefined,
		};
	}

	async markRepositoryStale(
		repoName: string,
		detail = "Repository contents changed and require refresh",
	): Promise<RepositoryIndexStatus> {
		this.logDebug("marking repository stale", {
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
		this.logDebug("stored stale repository status", {
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
			this.logDebug("lexical readiness verification threw", {
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
			this.logDebug("stored lexical status verified ready", {
				repo: repoName,
				backend: existing.backend,
				configuredBackend: existing.configuredBackend,
			});
			return existing;
		}

		this.logDebug("stored lexical status is no longer ready", {
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
		this.logDebug("starting refreshRepositoryInternal", {
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

		this.logDebug("stored indexing status", {
			repo: repository.name,
			configuredBackend: this.lexicalBackend.kind,
		});

		const lexicalStatus =
			await this.lexicalBackend.prepareRepository(repository);
		this.logDebug("lexical refresh completed", {
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
			this.logDebug("symbol extraction completed", {
				repo: repository.name,
				symbolCount: symbols.length,
			});
		} catch (error) {
			this.logDebug("symbol extraction failed", {
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
		this.logDebug("stored final repository status", {
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
		this.logDebug("reading index status", {
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

	private assertRefreshNotInFlight(repoName: string): void {
		if (!this.inFlightRefreshes.has(repoName)) {
			return;
		}

		throw new CodeAtlasError(
			`Cannot mutate lifecycle for '${repoName}' while refresh_repo is in-flight`,
		);
	}
}
