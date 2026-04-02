import type {
	IndexStatusReason,
	RepositoryIndexStatus,
} from "../metadata/metadata-store.js";
import type { RepositoryRecord } from "../registry/repository-registry.js";

export interface BackendSearchRequest {
	query: string;
	limit: number;
}

export interface BackendSearchHit {
	path: string;
	startLine: number;
	endLine: number;
	snippet: string;
	score: number;
}

export interface BackendRepositoryReadiness {
	ready: boolean;
	state?: "stale" | "error";
	reason?: IndexStatusReason;
	detail?: string;
}

export interface LexicalSearchBackend {
	readonly kind: string;
	getBootstrapBackendKind?(): string | undefined;
	prepareRepository(
		repository: RepositoryRecord,
	): Promise<RepositoryIndexStatus>;
	deleteRepositoryArtifacts?(repository: RepositoryRecord): Promise<void>;
	searchRepository(
		repository: RepositoryRecord,
		request: BackendSearchRequest,
	): Promise<BackendSearchHit[]>;
	verifyRepositoryReady?(
		repository: RepositoryRecord,
		existingStatus?: RepositoryIndexStatus,
	): Promise<BackendRepositoryReadiness>;
}
