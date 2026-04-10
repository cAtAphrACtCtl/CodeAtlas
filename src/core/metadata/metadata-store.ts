export type IndexState =
	| "not_indexed"
	| "indexing"
	| "ready"
	| "stale"
	| "error";

export type ServiceTier =
	| "full"
	| "lexical-only"
	| "fallback"
	| "unavailable";

export type IndexStatusReason =
	| "refresh_in_progress"
	| "refresh_failed"
	| "repository_stale"
	| "repository_source_changed"
	| "repository_root_not_directory"
	| "ripgrep_unavailable"
	| "ripgrep_naive_fallback"
	| "zoekt_unavailable"
	| "zoekt_index_build_failed"
	| "configured_backend_mismatch"
	| "fallback_backend_unverified"
	| "zoekt_index_missing"
	| "zoekt_index_not_directory"
	| "zoekt_index_no_shards"
	| "zoekt_index_inspection_failed"
	| "lexical_readiness_verification_failed"
	| "symbol_index_failed";

export interface RepositoryIndexStatus {
	repo: string;
	backend: string;
	configuredBackend?: string;
	activeBackend?: string;
	fallbackActive?: boolean;
	fallbackReason?: string;
	serviceTier?: ServiceTier;
	state: IndexState;
	reason?: IndexStatusReason;
	jobId?: string;
	jobPhase?: "queued" | "building_lexical" | "building_symbols";
	jobQueuedAt?: string;
	jobStartedAt?: string;
	jobUpdatedAt?: string;
	progressMessage?: string;
	lastIndexedAt?: string;
	symbolState?: IndexState;
	symbolLastIndexedAt?: string;
	symbolCount?: number;
	detail?: string;

	// Performance timing fields (populated after refresh completes)
	lastRefreshDurationMs?: number;
	zoektBuildDurationMs?: number;
	symbolExtractionDurationMs?: number;
	lastSearchDurationMs?: number;
	searchBackend?: string;

	// Staleness watch points (used to detect source code changes)
	sourceRootMtime?: number; // mtime of repository root directory after last refresh
	indexRootMtime?: number; // mtime of active index directory after last refresh
	gitHeadMtime?: number; // mtime of .git/HEAD after last refresh (if present)
}

export function deriveServiceTier(
	status: Pick<
		RepositoryIndexStatus,
		| "state"
		| "symbolState"
		| "fallbackActive"
		| "lastIndexedAt"
		| "backend"
		| "configuredBackend"
	>,
): ServiceTier {
	if (
		status.fallbackActive ||
		(status.configuredBackend !== undefined &&
			status.backend !== status.configuredBackend)
	) {
		return "fallback";
	}

	if (status.state === "ready" && status.symbolState === "ready") {
		return "full";
	}

	if (status.state === "ready") {
		return "lexical-only";
	}

	if (
		(status.state === "indexing" ||
			status.state === "stale" ||
			status.state === "error") &&
		Boolean(status.lastIndexedAt)
	) {
		return "lexical-only";
	}

	return "unavailable";
}

export interface MetadataStore {
	listIndexStatuses(): Promise<RepositoryIndexStatus[]>;
	getIndexStatus(repo: string): Promise<RepositoryIndexStatus | null>;
	setIndexStatus(status: RepositoryIndexStatus): Promise<void>;
	deleteIndexStatus?(repo: string): Promise<RepositoryIndexStatus | null>;
}
