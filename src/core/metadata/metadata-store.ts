export type IndexState =
	| "not_indexed"
	| "indexing"
	| "ready"
	| "stale"
	| "error";

export type IndexStatusReason =
	| "refresh_in_progress"
	| "refresh_failed"
	| "repository_stale"
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
}

export interface MetadataStore {
	listIndexStatuses(): Promise<RepositoryIndexStatus[]>;
	getIndexStatus(repo: string): Promise<RepositoryIndexStatus | null>;
	setIndexStatus(status: RepositoryIndexStatus): Promise<void>;
	deleteIndexStatus?(repo: string): Promise<RepositoryIndexStatus | null>;
}
