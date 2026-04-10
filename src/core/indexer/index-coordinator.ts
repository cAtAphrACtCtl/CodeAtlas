import { toErrorDetails } from "../common/debug.js";
import { CodeAtlasError } from "../common/errors.js";
import type {
	deriveServiceTier,
	MetadataStore,
	RepositoryIndexStatus,
} from "../metadata/metadata-store.js";
import { deriveServiceTier as computeServiceTier } from "../metadata/metadata-store.js";
import type { RepositoryRegistry } from "../registry/repository-registry.js";
import type { LexicalSearchBackend } from "../search/lexical-search-backend.js";
import type { TypeScriptSymbolExtractor } from "../search/symbol-extractor.js";
import type { SymbolIndexStore } from "../search/symbol-index-store.js";
import { getLogger, type Logger } from "../logging/logger.js";
import { stat } from "node:fs/promises";
import path from "node:path";

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

export interface IndexCoordinatorOptions {
	enableSymbolExtraction?: boolean;
}

export class IndexCoordinator {
	private readonly inFlightRefreshes = new Map<
		string,
		{
			jobId: string;
			promise: Promise<RepositoryIndexStatus>;
		}
	>();
	private readonly logger: Logger | undefined;
	private readonly enableSymbolExtraction: boolean;

	constructor(
		private readonly registry: RepositoryRegistry,
		private readonly metadataStore: MetadataStore,
		private readonly lexicalBackend: LexicalSearchBackend,
		private readonly symbolExtractor: TypeScriptSymbolExtractor,
		private readonly symbolIndexStore: SymbolIndexStore,
		options: IndexCoordinatorOptions = {},
	) {
		this.logger = getLogger();
		this.enableSymbolExtraction = options.enableSymbolExtraction ?? true;
	}

	private logDebug(message: string, details?: Record<string, unknown>): void {
		this.logger?.debug("indexer", message, { details });
	}

	private deriveActiveBackend(
		existing?: RepositoryIndexStatus | null,
	): string {
		return (
			existing?.activeBackend ??
			existing?.backend ??
			this.lexicalBackend.getBootstrapBackendKind?.() ??
			this.lexicalBackend.kind
		);
	}

	private buildFallbackDetails(
		activeBackend: string,
		reason?: RepositoryIndexStatus["reason"],
		detail?: string,
	): Pick<
		RepositoryIndexStatus,
		"activeBackend" | "fallbackActive" | "fallbackReason"
	> {
		const fallbackActive = activeBackend !== this.lexicalBackend.kind;
		return {
			activeBackend,
			fallbackActive,
			fallbackReason: fallbackActive
				? detail ?? reason ?? "Configured backend is not currently active"
				: undefined,
		};
	}

	private withServiceTier<T extends RepositoryIndexStatus>(status: T): T {
		return {
			...status,
			serviceTier: computeServiceTier(status),
		};
	}

	private async captureWatchPoints(
		repository: any,
		status: RepositoryIndexStatus,
	): Promise<RepositoryIndexStatus> {
		try {
			// Capture repository root directory modification time
			const repoRootStats = await stat(repository.rootPath);
			status.sourceRootMtime = repoRootStats.mtimeMs;

			// Try to capture .git/HEAD modification time if present
			const gitHeadPath = path.join(repository.rootPath, ".git", "HEAD");
			try {
				const gitHeadStats = await stat(gitHeadPath);
				status.gitHeadMtime = gitHeadStats.mtimeMs;
			} catch {
				// .git/HEAD doesn't exist or is unreadable; silently skip
			}

			this.logDebug("watch points captured for staleness detection", {
				repo: repository.name,
				sourceRootMtime: status.sourceRootMtime,
				gitHeadMtime: status.gitHeadMtime,
			});
		} catch (error) {
			this.logDebug("unable to capture watch points", {
				repo: repository.name,
				...toErrorDetails(error),
			});
		}

		return status;
	}

	async recordLexicalSearchObservation(
		repoName: string,
		observation: {
			durationMs: number;
			backend?: string;
		},
	): Promise<void> {
		const existing = await this.metadataStore.getIndexStatus(repoName);
		if (!existing) {
			return;
		}

		const activeBackend =
			observation.backend ?? existing.activeBackend ?? existing.backend;
		await this.metadataStore.setIndexStatus(this.withServiceTier({
			...existing,
			...this.buildFallbackDetails(activeBackend, existing.reason, existing.detail),
			lastSearchDurationMs: observation.durationMs,
			searchBackend: activeBackend,
		}));
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
			this.logDebug("returning current status while lexical refresh is in-flight", {
				repo: repoName,
				jobId: inFlight.jobId,
			});
			return (
				(await this.metadataStore.getIndexStatus(repoName)) ??
				(await this.buildIndexingStatus(repoName, inFlight.jobId))
			);
		}

		return this.submitRefresh(repoName);
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
			return inFlight.promise;
		}

		return this.refreshRepository(repoName);
	}

	async submitRefresh(repoName: string): Promise<RepositoryIndexStatus> {
		this.logDebug("submitting repository refresh", {
			repo: repoName,
		});
		const existingRefresh = this.inFlightRefreshes.get(repoName);
		if (existingRefresh) {
			return (
				(await this.metadataStore.getIndexStatus(repoName)) ??
				(await this.buildIndexingStatus(repoName, existingRefresh.jobId))
			);
		}

		const jobId = this.createRefreshJobId(repoName);
		const indexingStatusPromise = (async () => {
			const indexingStatus = await this.buildIndexingStatus(repoName, jobId);
			await this.metadataStore.setIndexStatus(indexingStatus);
			return indexingStatus;
		})();
		const refreshPromise = indexingStatusPromise.then((indexingStatus) =>
			this.refreshRepositoryInternal(repoName, indexingStatus),
		);
		this.inFlightRefreshes.set(repoName, {
			jobId,
			promise: refreshPromise,
		});

		void refreshPromise.catch(() => undefined).finally(() => {
			const current = this.inFlightRefreshes.get(repoName);
			if (current?.jobId === jobId) {
				this.inFlightRefreshes.delete(repoName);
			}
		});

		return indexingStatusPromise;
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
			return existingRefresh.promise;
		}

		await this.submitRefresh(repoName);
		const refresh = this.inFlightRefreshes.get(repoName);
		if (!refresh) {
			const status = await this.metadataStore.getIndexStatus(repoName);
			if (!status) {
				throw new CodeAtlasError(`Refresh job was not created for repository: ${repoName}`);
			}
			return status;
		}

		return refresh.promise;
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
		await this.metadataStore.setIndexStatus(this.withServiceTier({
			repo: repository.name,
			backend: existing?.backend ?? this.lexicalBackend.kind,
			configuredBackend: existing?.configuredBackend ?? this.lexicalBackend.kind,
			...this.buildFallbackDetails(
				this.deriveActiveBackend(existing),
				existing?.reason,
				existing?.detail,
			),
			state: removedLexical ? "not_indexed" : (existing?.state ?? "not_indexed"),
			symbolState: removedSymbols
				? "not_indexed"
				: (existing?.symbolState ?? "not_indexed"),
			reason: undefined,
			lastIndexedAt: removedLexical ? undefined : existing?.lastIndexedAt,
			lastSearchDurationMs: existing?.lastSearchDurationMs,
			searchBackend: existing?.searchBackend,
			symbolLastIndexedAt: removedSymbols
				? undefined
				: existing?.symbolLastIndexedAt,
			symbolCount: removedSymbols ? 0 : existing?.symbolCount,
			detail:
				errors.length === 0
					? `Index cleanup completed (target=${target})`
					: `Index cleanup partially completed (target=${target}): ${errors.join("; ")}`,
		}));

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
			...this.buildFallbackDetails(
				this.deriveActiveBackend(existing),
				existing?.reason,
				existing?.detail,
			),
			state: "stale",
			reason: "repository_stale",
			lastIndexedAt: existing?.lastIndexedAt,
			lastSearchDurationMs: existing?.lastSearchDurationMs,
			searchBackend: existing?.searchBackend,
			symbolState:
				existing?.symbolState === "not_indexed" ||
				existing?.symbolState === undefined
					? existing?.symbolState
					: "stale",
			symbolLastIndexedAt: existing?.symbolLastIndexedAt,
			symbolCount: existing?.symbolCount,
			detail,
		};

		await this.metadataStore.setIndexStatus(this.withServiceTier(status));
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
			return this.withServiceTier(existing);
		}

		this.logDebug("stored lexical status is no longer ready", {
			repo: repoName,
			backend: existing.backend,
			configuredBackend: existing.configuredBackend,
			nextState: readiness.state ?? "stale",
			detail: readiness.detail,
		});

		await this.metadataStore.setIndexStatus(this.withServiceTier({
			...existing,
			backend: existing.backend || this.lexicalBackend.kind,
			configuredBackend: existing.configuredBackend ?? this.lexicalBackend.kind,
			...this.buildFallbackDetails(
				this.deriveActiveBackend(existing),
				readiness.reason,
				readiness.detail ?? existing.detail,
			),
			state: readiness.state ?? "stale",
			reason: readiness.reason,
			detail: readiness.detail ?? existing.detail,
		}));

		return null;
	}

	private async buildIndexingStatus(
		repoName: string,
		jobId: string,
	): Promise<RepositoryIndexStatus> {
		const repository = await this.registry.getRepository(repoName);
		if (!repository) {
			throw new CodeAtlasError(`Unknown repository: ${repoName}`);
		}

		const existing = await this.metadataStore.getIndexStatus(repoName);
		const now = new Date().toISOString();
		const activeBackend = this.deriveActiveBackend(existing);
		return this.withServiceTier({
			repo: repository.name,
			backend: existing?.backend ?? this.lexicalBackend.kind,
			configuredBackend: this.lexicalBackend.kind,
			...this.buildFallbackDetails(
				activeBackend,
				"refresh_in_progress",
				activeBackend === this.lexicalBackend.kind
					? "Repository refresh in progress"
					: `Repository refresh in progress; lexical search remains available via ${activeBackend}`,
			),
			state: "indexing",
			reason: "refresh_in_progress",
			jobId,
			jobPhase: "building_lexical",
			jobQueuedAt: now,
			jobStartedAt: now,
			jobUpdatedAt: now,
			progressMessage: "Repository refresh in progress",
			lastIndexedAt: existing?.lastIndexedAt,
			lastSearchDurationMs: existing?.lastSearchDurationMs,
			searchBackend: existing?.searchBackend,
			symbolState: existing?.symbolState ?? "not_indexed",
			symbolLastIndexedAt: existing?.symbolLastIndexedAt,
			symbolCount: existing?.symbolCount,
			detail: "Repository refresh in progress",
		});
	}

	private createRefreshJobId(repoName: string): string {
		return `refresh-${repoName.toLowerCase()}-${Date.now()}`;
	}

	private async refreshRepositoryInternal(
		repoName: string,
		indexingStatus?: RepositoryIndexStatus,
	): Promise<RepositoryIndexStatus> {
		this.logDebug("starting refreshRepositoryInternal", {
			repo: repoName,
		});
		const refreshStart = performance.now();
		const repository = await this.registry.getRepository(repoName);
		if (!repository) {
			throw new CodeAtlasError(`Unknown repository: ${repoName}`);
		}

		const existing = await this.metadataStore.getIndexStatus(repoName);
		const activeIndexingStatus =
			indexingStatus ??
			(await this.buildIndexingStatus(
				repoName,
				this.createRefreshJobId(repoName),
			));
		if (!indexingStatus) {
			await this.metadataStore.setIndexStatus(activeIndexingStatus);
		}

		this.logDebug("stored indexing status", {
			repo: repository.name,
			configuredBackend: this.lexicalBackend.kind,
		});

		try {
			const lexicalStatus =
				await this.lexicalBackend.prepareRepository(repository);
			this.logDebug("lexical refresh completed", {
				repo: repository.name,
				backend: lexicalStatus.backend,
				state: lexicalStatus.state,
				detail: lexicalStatus.detail,
			});
			const indexedAt = new Date().toISOString();
			if (!this.enableSymbolExtraction) {
				const refreshDurationMs = Math.round(performance.now() - refreshStart);
				const status = this.withServiceTier({
					...lexicalStatus,
					configuredBackend: this.lexicalBackend.kind,
					...this.buildFallbackDetails(
						lexicalStatus.activeBackend ?? lexicalStatus.backend,
						lexicalStatus.reason,
						lexicalStatus.detail,
					),
					jobId: undefined,
					jobPhase: undefined,
					jobQueuedAt: undefined,
					jobStartedAt: undefined,
					jobUpdatedAt: undefined,
					progressMessage: undefined,
					lastSearchDurationMs: existing?.lastSearchDurationMs,
					searchBackend: existing?.searchBackend,
					symbolState: "not_indexed",
					symbolLastIndexedAt: undefined,
					symbolCount: undefined,
					detail: lexicalStatus.detail
						? `${lexicalStatus.detail}; symbol extraction disabled by configuration`
						: "Symbol extraction disabled by configuration",
					lastRefreshDurationMs: refreshDurationMs,
				});

				await this.metadataStore.setIndexStatus(status);
				this.logDebug("stored final repository status with symbol extraction disabled", {
					repo: repository.name,
					backend: status.backend,
					configuredBackend: status.configuredBackend,
					state: status.state,
					symbolState: status.symbolState,
					detail: status.detail,
				});
				return status;
			}

			let status: RepositoryIndexStatus = {
				...lexicalStatus,
				configuredBackend: this.lexicalBackend.kind,
				...this.buildFallbackDetails(
					lexicalStatus.activeBackend ?? lexicalStatus.backend,
					lexicalStatus.reason,
					lexicalStatus.detail,
				),
				jobId: activeIndexingStatus.jobId,
				jobPhase: "building_symbols",
				jobQueuedAt: activeIndexingStatus.jobQueuedAt,
				jobStartedAt: activeIndexingStatus.jobStartedAt,
				jobUpdatedAt: new Date().toISOString(),
				progressMessage: "Symbol extraction in progress",
				lastSearchDurationMs: existing?.lastSearchDurationMs,
				searchBackend: existing?.searchBackend,
				symbolState: "indexing",
				symbolLastIndexedAt: existing?.symbolLastIndexedAt,
				symbolCount: existing?.symbolCount,
			};
			status = this.withServiceTier(status);
			await this.metadataStore.setIndexStatus(status);
			this.logDebug("stored lexical-ready status while symbol extraction continues", {
				repo: repository.name,
				backend: status.backend,
				configuredBackend: status.configuredBackend,
				state: status.state,
				symbolState: status.symbolState,
				serviceTier: status.serviceTier,
			});

			try {
				const symbolStart = performance.now();
				const symbols = await this.symbolExtractor.extractRepository(repository);
				const symbolDurationMs = Math.round(performance.now() - symbolStart);
				await this.symbolIndexStore.setSymbols(repository.name, symbols);
				status = {
					...status,
					symbolState: "ready",
					symbolLastIndexedAt: indexedAt,
					symbolCount: symbols.length,
					symbolExtractionDurationMs: symbolDurationMs,
				};
				this.logDebug("symbol extraction completed", {
					repo: repository.name,
					symbolCount: symbols.length,
					symbolExtractionDurationMs: symbolDurationMs,
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

			const refreshDurationMs = Math.round(performance.now() - refreshStart);
			status = this.withServiceTier({
				...status,
				jobId: undefined,
				jobPhase: undefined,
				jobQueuedAt: undefined,
				jobStartedAt: undefined,
				jobUpdatedAt: undefined,
				progressMessage: undefined,
				lastRefreshDurationMs: refreshDurationMs,
			});

		// Capture watch points for detecting future source code changes
		status = await this.captureWatchPoints(repository, status);

		await this.metadataStore.setIndexStatus(status);
		this.logger?.info("indexer", "repository refresh completed", {
			event: "index.refresh.complete",
			repo: repository.name,
			durationMs: refreshDurationMs,
			details: {
				backend: status.backend,
				configuredBackend: status.configuredBackend,
				state: status.state,
				symbolState: status.symbolState,
				zoektBuildDurationMs: status.zoektBuildDurationMs,
				symbolExtractionDurationMs: status.symbolExtractionDurationMs,
			},
		});
		this.logDebug("stored final repository status", {
			repo: repository.name,
			backend: status.backend,
			configuredBackend: status.configuredBackend,
			state: status.state,
			symbolState: status.symbolState,
			detail: status.detail,
		});
		return status;
		} catch (error) {
			const failedStatus: RepositoryIndexStatus = this.withServiceTier({
				...activeIndexingStatus,
				...this.buildFallbackDetails(
					activeIndexingStatus.activeBackend ??
						this.deriveActiveBackend(existing),
					"refresh_failed",
					`Repository refresh failed: ${String(error)}`,
				),
				state: "error",
				reason: "refresh_failed",
				symbolState: existing?.symbolState ?? "error",
				symbolLastIndexedAt: existing?.symbolLastIndexedAt,
				symbolCount: existing?.symbolCount,
				jobUpdatedAt: new Date().toISOString(),
				detail: `Repository refresh failed: ${String(error)}`,
				lastRefreshDurationMs: Math.round(performance.now() - refreshStart),
			});
			await this.metadataStore.setIndexStatus(failedStatus);
			this.logger?.error("indexer", "repository refresh failed", {
				event: "index.refresh.failed",
				repo: repository.name,
				durationMs: failedStatus.lastRefreshDurationMs,
				error: toErrorDetails(error),
			});
			throw error;
		}
	}

	async getStatus(repoName?: string): Promise<RepositoryIndexStatus[]> {
		this.logDebug("reading index status", {
			repo: repoName,
		});
		if (repoName) {
			const existing = await this.metadataStore.getIndexStatus(repoName);
			if (existing) {
				return [this.withServiceTier(existing)];
			}

			return [
				this.withServiceTier({
					repo: repoName,
					backend: this.lexicalBackend.kind,
					configuredBackend: this.lexicalBackend.kind,
					...this.buildFallbackDetails(this.lexicalBackend.kind),
					state: "not_indexed",
					symbolState: "not_indexed",
				}),
			];
		}

		const repositories = await this.registry.listRepositories();
		const statuses = await this.metadataStore.listIndexStatuses();
		const statusMap = new Map(statuses.map((status) => [status.repo, status]));

		return repositories.map((repository) => {
			return (
				(statusMap.get(repository.name)
					? this.withServiceTier(statusMap.get(repository.name)!)
					: this.withServiceTier({
					repo: repository.name,
					backend: this.lexicalBackend.kind,
					configuredBackend: this.lexicalBackend.kind,
					...this.buildFallbackDetails(this.lexicalBackend.kind),
					state: "not_indexed",
					symbolState: "not_indexed",
				}))
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
