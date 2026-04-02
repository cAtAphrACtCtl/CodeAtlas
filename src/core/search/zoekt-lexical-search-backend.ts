import { execFile } from "node:child_process";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { toErrorDetails } from "../common/debug.js";
import type { ZoektLexicalBackendConfig } from "../configuration/config.js";
import {
	getRepoArtifactDir,
	getRepoBuildDir,
	getRepoIndexDir,
	getRepoPreviousDir,
} from "../indexer/repo-artifact-path.js";
import type { RepositoryIndexStatus } from "../metadata/metadata-store.js";
import type { RepositoryRecord } from "../registry/repository-registry.js";
import {
	type BackendSearchHit,
	type BackendSearchRequest,
	type LexicalSearchBackend,
} from "./lexical-search-backend.js";
import { skippedDirectories } from "./lexical-boundaries.js";
import { getLogger, type Logger } from "../logging/logger.js";

type ZoektExecOptions = {
	windowsHide: boolean;
	timeout: number;
	maxBuffer?: number;
};

type ZoektExecResult = {
	stdout: string;
	stderr: string;
};

type ZoektExec = (
	file: string,
	args: string[],
	options: ZoektExecOptions,
) => Promise<ZoektExecResult>;

interface ZoektRuntimeOptions {
	execFile: ZoektExec;
	availabilityTimeoutMs: number;
	indexBuildTimeoutMs: number;
	searchTimeoutMs: number;
	maxBytesPerFile: number;
}

const execFileAsync = promisify(execFile) as unknown as ZoektExec;
const defaultZoektRuntime: ZoektRuntimeOptions = {
	execFile: execFileAsync,
	availabilityTimeoutMs: 5_000,
	indexBuildTimeoutMs: 120_000,
	searchTimeoutMs: 30_000,
	maxBytesPerFile: 256 * 1024,
};
const defaultResultScore = 100;
const minimumResultScore = 1;

function toPosixPath(filePath: string): string {
	return filePath.split(path.sep).join("/");
}

function toRepositoryRelativePath(
	repositoryRoot: string,
	rawPath: string,
): string {
	if (!path.isAbsolute(rawPath)) {
		return toPosixPath(rawPath).replace(/^\.\//, "");
	}

	const relativePath = path.relative(repositoryRoot, rawPath);
	if (
		relativePath !== "" &&
		!relativePath.startsWith("..") &&
		!path.isAbsolute(relativePath)
	) {
		return toPosixPath(relativePath);
	}

	return toPosixPath(rawPath);
}

function scoreZoektHit(resultIndex: number): number {
	return Math.max(minimumResultScore, defaultResultScore - resultIndex);
}

interface ZoektAvailability {
	available: boolean;
	reason?: "zoekt_unavailable";
	detail: string;
}

export class ZoektLexicalSearchBackend implements LexicalSearchBackend {
	readonly kind = "zoekt";
	private zoektAvailability?: ZoektAvailability;
	private readonly runtime: ZoektRuntimeOptions;
	private readonly logger: Logger | undefined;

	constructor(
		private readonly backendConfig: ZoektLexicalBackendConfig,
		private readonly bootstrapBackend?: LexicalSearchBackend,
		runtime?: Partial<ZoektRuntimeOptions>,
	) {
		this.logger = getLogger();
		this.runtime = {
			...defaultZoektRuntime,
			...runtime,
		};

		// Development environments can still route through the bootstrap backend
		// when Zoekt is configured but not yet available locally.
		if (backendConfig.allowBootstrapFallback && !bootstrapBackend) {
			throw new Error(
				"Zoekt bootstrap fallback is enabled but no bootstrap backend was provided",
			);
		}
	}

	private logDebug(message: string, details?: Record<string, unknown>): void {
		this.logger?.debug("zoekt", message, { details });
	}

	getBootstrapBackendKind(): string | undefined {
		if (!this.backendConfig.allowBootstrapFallback) {
			return undefined;
		}

		return this.bootstrapBackend?.kind;
	}

	async prepareRepository(
		repository: RepositoryRecord,
	): Promise<RepositoryIndexStatus> {
		const repositoryStats = await stat(repository.rootPath);
		if (!repositoryStats.isDirectory()) {
			return {
				repo: repository.name,
				backend: this.kind,
				state: "error",
				reason: "repository_root_not_directory",
				detail: "Repository root is not a directory",
			};
		}

		const availability = await this.getZoektAvailability();
		if (!availability.available) {
			this.logDebug("prepareRepository using fallback because Zoekt is unavailable",
				{
					repo: repository.name,
					detail: availability.detail,
				},
			);
			return this.prepareWithFallback(
				repository,
				availability.detail,
				availability.reason ?? "zoekt_unavailable",
			);
		}

		try {
			const buildDir = getRepoBuildDir(
				this.backendConfig.indexRoot,
				repository.name,
				repository.rootPath,
			);
			const activeDir = getRepoIndexDir(
				this.backendConfig.indexRoot,
				repository.name,
				repository.rootPath,
			);
			const previousDir = getRepoPreviousDir(
				this.backendConfig.indexRoot,
				repository.name,
				repository.rootPath,
			);
			this.logDebug("starting zoekt prepareRepository", {
				repo: repository.name,
				executable: this.backendConfig.zoektIndexExecutable,
				buildDir,
				activeDir,
				rootPath: repository.rootPath,
				timeoutMs: this.runtime.indexBuildTimeoutMs,
				maxBytesPerFile: this.runtime.maxBytesPerFile,
				ignoredDirectories: skippedDirectories,
			});
			await rm(buildDir, { recursive: true, force: true });
			await mkdir(buildDir, { recursive: true });
			const buildStart = performance.now();
			await this.runtime.execFile(
				this.backendConfig.zoektIndexExecutable,
				[
					"-file_limit",
					String(this.runtime.maxBytesPerFile),
					"-ignore_dirs",
					skippedDirectories.join(","),
					"-index",
					buildDir,
					repository.rootPath,
				],
				{
					windowsHide: true,
					maxBuffer: 16 * 1024 * 1024,
					timeout: this.runtime.indexBuildTimeoutMs,
				},
			);
			const buildDurationMs = Math.round(performance.now() - buildStart);
			const validationStart = performance.now();
			await this.validateStagingDir(repository, buildDir);
			const validationDurationMs = Math.round(performance.now() - validationStart);
			this.logger?.info("zoekt", "zoekt staging validation completed", {
				event: "index.zoekt_staging_validation.complete",
				repo: repository.name,
				durationMs: validationDurationMs,
			});
			const promotionStart = performance.now();
			await this.promoteStagingToActive(repository, buildDir, activeDir, previousDir);
			const promotionDurationMs = Math.round(performance.now() - promotionStart);
			this.logger?.info("zoekt", "zoekt promotion completed", {
				event: "index.zoekt_promotion.complete",
				repo: repository.name,
				durationMs: promotionDurationMs,
			});

			const status: RepositoryIndexStatus = {
				repo: repository.name,
				backend: this.kind,
				state: "ready",
				lastIndexedAt: new Date().toISOString(),
				zoektBuildDurationMs: buildDurationMs,
				detail: `Lexical index available via Zoekt at ${activeDir}`,
			};

			this.logger?.info("zoekt", "zoekt build completed", {
				event: "index.zoekt_build.complete",
				repo: repository.name,
				durationMs: buildDurationMs,
			});

			return status;
		} catch (error) {
			await rm(
				getRepoBuildDir(
					this.backendConfig.indexRoot,
					repository.name,
					repository.rootPath,
				),
				{ recursive: true, force: true },
			);
			this.logDebug("zoekt prepareRepository failed", {
				repo: repository.name,
				...toErrorDetails(error),
			});
			const detail = error instanceof Error ? error.message : String(error);
			this.logger?.warn("zoekt", "zoekt build failed", {
				event: "index.zoekt_build.failed",
				repo: repository.name,
			});
			return this.prepareWithFallback(
				repository,
				`Zoekt index build failed: ${detail}`,
				"zoekt_index_build_failed",
			);
		}
	}

	async deleteRepositoryArtifacts(repository: RepositoryRecord): Promise<void> {
		const artifactDir = getRepoArtifactDir(
			this.backendConfig.indexRoot,
			repository.name,
			repository.rootPath,
		);
		await rm(artifactDir, { recursive: true, force: true });
		this.logDebug("deleted zoekt repository artifacts", {
			repo: repository.name,
			indexDir: artifactDir,
		});
	}

	async searchRepository(
		repository: RepositoryRecord,
		request: BackendSearchRequest,
	): Promise<BackendSearchHit[]> {
		const availability = await this.getZoektAvailability();
		if (!availability.available) {
			this.logDebug("searchRepository using fallback because Zoekt is unavailable",
				{
					repo: repository.name,
					query: request.query,
					detail: availability.detail,
				},
			);
			return this.searchWithFallback(repository, request, availability.detail);
		}

		try {
			const indexDir = getRepoIndexDir(
				this.backendConfig.indexRoot,
				repository.name,
				repository.rootPath,
			);
			const directoryStats = await stat(indexDir);
			if (!directoryStats.isDirectory()) {
				return this.searchWithFallback(
					repository,
					request,
					`Zoekt index path is not ready for repository ${repository.name}: ${indexDir}`,
				);
			}
			const entries = await readdir(indexDir, { withFileTypes: true });
			const hasShardFiles = entries.some(
				(entry) => entry.isFile() && entry.name.endsWith(".zoekt"),
			);
			if (!hasShardFiles) {
				return this.searchWithFallback(
					repository,
					request,
					`Zoekt index is not ready for repository ${repository.name}: ${indexDir}`,
				);
			}
			this.logDebug("starting zoekt searchRepository", {
				repo: repository.name,
				executable: this.backendConfig.zoektSearchExecutable,
				indexDir,
				query: request.query,
				timeoutMs: this.runtime.searchTimeoutMs,
			});
			const searchStart = performance.now();
			const { stdout } = await this.runtime.execFile(
				this.backendConfig.zoektSearchExecutable,
				["-index_dir", indexDir, request.query],
				{
					windowsHide: true,
					maxBuffer: 16 * 1024 * 1024,
					timeout: this.runtime.searchTimeoutMs,
				},
			);

			const hits = this.parseZoektOutput(
				repository.rootPath,
				stdout,
				request.limit,
			);
			const searchDurationMs = Math.round(performance.now() - searchStart);
			this.logger?.info("zoekt", "zoekt search completed", {
				event: "search.zoekt_exec.complete",
				repo: repository.name,
				durationMs: searchDurationMs,
				details: {
					query: request.query,
					hitCount: hits.length,
				},
			});
			return hits;
		} catch (error) {
			this.logDebug("zoekt searchRepository failed", {
				repo: repository.name,
				...toErrorDetails(error),
			});
			const detail = error instanceof Error ? error.message : String(error);
			return this.searchWithFallback(
				repository,
				request,
				`Zoekt search failed: ${detail}`,
			);
		}
	}

	async verifyRepositoryReady(
		repository: RepositoryRecord,
		existingStatus?: RepositoryIndexStatus,
	): Promise<{
		ready: boolean;
		state?: "stale" | "error";
		reason?: RepositoryIndexStatus["reason"];
		detail?: string;
	}> {
		const readinessStart = performance.now();
		this.logDebug("verifying zoekt repository readiness", {
			repo: repository.name,
			existingBackend: existingStatus?.backend,
			existingConfiguredBackend: existingStatus?.configuredBackend,
		});
		const finalizeReadiness = <T extends {
			ready: boolean;
			state?: "stale" | "error";
			reason?: RepositoryIndexStatus["reason"];
			detail?: string;
		}>(result: T): T => {
			const durationMs = Math.round(performance.now() - readinessStart);
			this.logger?.info("zoekt", "zoekt readiness check completed", {
				event: "index.readiness_check.complete",
				repo: repository.name,
				durationMs,
				details: {
					ready: result.ready,
					reason: result.reason,
				},
			});
			return result;
		};
		const configuredBackend =
			existingStatus?.configuredBackend ?? existingStatus?.backend;
		if (configuredBackend && configuredBackend !== this.kind) {
			return finalizeReadiness({
				ready: false,
				state: "stale",
				reason: "configured_backend_mismatch",
				detail: `Stored lexical status was prepared for backend ${configuredBackend}, but active backend is ${this.kind}`,
			});
		}

		if (existingStatus?.backend && existingStatus.backend !== this.kind) {
			if (
				this.backendConfig.allowBootstrapFallback &&
				this.bootstrapBackend?.verifyRepositoryReady
			) {
				return finalizeReadiness(await this.bootstrapBackend.verifyRepositoryReady(
					repository,
					existingStatus,
				));
			}

			return finalizeReadiness({
				ready: false,
				state: "stale",
				reason: "fallback_backend_unverified",
				detail: `Stored lexical status uses fallback backend ${existingStatus.backend}, but no active readiness verifier is available for it`,
			});
		}

		const availability = await this.getZoektAvailability();
		if (!availability.available) {
			this.logDebug("repository readiness failed because Zoekt is unavailable",
				{
					repo: repository.name,
					detail: availability.detail,
				},
			);
			return finalizeReadiness({
				ready: false,
				state: "stale",
				reason: availability.reason ?? "zoekt_unavailable",
				detail: availability.detail,
			});
		}

		const indexDir = getRepoIndexDir(
			this.backendConfig.indexRoot,
			repository.name,
			repository.rootPath,
		);

		try {
			const directoryStats = await stat(indexDir);
			if (!directoryStats.isDirectory()) {
				return finalizeReadiness({
					ready: false,
					state: "stale",
					reason: "zoekt_index_not_directory",
					detail: `Zoekt index path is not a directory for repository ${repository.name}: ${indexDir}`,
				});
			}

			const entries = await readdir(indexDir, { withFileTypes: true });
			const hasShardFiles = entries.some(
				(entry) => entry.isFile() && entry.name.endsWith(".zoekt"),
			);

			if (!hasShardFiles) {
				return finalizeReadiness({
					ready: false,
					state: "stale",
					reason: "zoekt_index_no_shards",
					detail: `Zoekt index directory has no shard files for repository ${repository.name}: ${indexDir}`,
				});
			}

			this.logDebug("repository readiness verified", {
				repo: repository.name,
				indexDir,
			});
			return finalizeReadiness({ ready: true });
		} catch (error) {
			this.logDebug("repository readiness inspection failed", {
				repo: repository.name,
				indexDir,
				...toErrorDetails(error),
			});
			const detail = error instanceof Error ? error.message : String(error);
			if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
				return finalizeReadiness({
					ready: false,
					state: "stale",
					reason: "zoekt_index_missing",
					detail: `Zoekt index directory is missing for repository ${repository.name}: ${indexDir}`,
				});
			}

			return finalizeReadiness({
				ready: false,
				state: "error",
				reason: "zoekt_index_inspection_failed",
				detail: `Unable to inspect Zoekt index directory for repository ${repository.name}: ${detail}`,
			});
		}
	}

	private async withBootstrapFallback<T>(
		detail: string,
		fallbackAction: () => Promise<T>,
		noFallbackAction: () => T | Promise<T>,
	): Promise<T> {
		if (this.backendConfig.allowBootstrapFallback && this.bootstrapBackend) {
			this.logDebug("executing bootstrap fallback", {
				detail,
				fallbackBackend: this.bootstrapBackend.kind,
			});
			return fallbackAction();
		}

		return noFallbackAction();
	}

	private async searchWithFallback(
		repository: RepositoryRecord,
		request: BackendSearchRequest,
		detail: string,
	): Promise<BackendSearchHit[]> {
		return this.withBootstrapFallback(
			detail,
			async () => {
				this.logger?.info("zoekt", "search fallback activated", {
					event: "search.fallback.activated",
					repo: repository.name,
					details: {
						query: request.query,
						originalBackend: this.kind,
						fallbackBackend: this.bootstrapBackend!.kind,
						reason: detail,
					},
				});
				return this.bootstrapBackend!.searchRepository(repository, request);
			},
			() => {
				throw new Error(detail);
			},
		);
	}

	private async prepareWithFallback(
		repository: RepositoryRecord,
		detail: string,
		reason: RepositoryIndexStatus["reason"],
	): Promise<RepositoryIndexStatus> {
		return this.withBootstrapFallback(
			detail,
			async () => {
				const fallbackStatus =
					await this.bootstrapBackend!.prepareRepository(repository);
				return {
					...fallbackStatus,
					reason,
					detail: fallbackStatus.detail
						? `${detail}; using bootstrap fallback: ${fallbackStatus.detail}`
						: `${detail}; using bootstrap fallback backend`,
				};
			},
			() => ({
				repo: repository.name,
				backend: this.kind,
				state: "error",
				reason,
				detail,
			}),
		);
	}

	private async validateStagingDir(
		repository: RepositoryRecord,
		stagingDir: string,
	): Promise<void> {
		const directoryStats = await stat(stagingDir);
		if (!directoryStats.isDirectory()) {
			throw new Error(
				`Zoekt staging path is not a directory for repository ${repository.name}: ${stagingDir}`,
			);
		}

		const entries = await readdir(stagingDir, { withFileTypes: true });
		const hasShardFiles = entries.some(
			(entry) => entry.isFile() && entry.name.endsWith(".zoekt"),
		);
		const hasTemporaryFiles = entries.some(
			(entry) => entry.isFile() && entry.name.endsWith(".tmp"),
		);

		if (!hasShardFiles) {
			throw new Error(
				`Zoekt staging directory has no shard files for repository ${repository.name}: ${stagingDir}`,
			);
		}

		if (hasTemporaryFiles) {
			throw new Error(
				`Zoekt staging directory still has temporary files for repository ${repository.name}: ${stagingDir}`,
			);
		}
	}

	private async promoteStagingToActive(
		repository: RepositoryRecord,
		stagingDir: string,
		activeDir: string,
		previousDir: string,
	): Promise<void> {
		let movedActiveToPrevious = false;
		try {
			await rm(previousDir, { recursive: true, force: true });
			if (await this.pathExists(activeDir)) {
				await rename(activeDir, previousDir);
				movedActiveToPrevious = true;
			}
			await rename(stagingDir, activeDir);
			await rm(previousDir, { recursive: true, force: true });
		} catch (error) {
			if (movedActiveToPrevious && !(await this.pathExists(activeDir))) {
				await rename(previousDir, activeDir).catch(() => undefined);
			}
			throw error;
		}
	}

	private async pathExists(targetPath: string): Promise<boolean> {
		try {
			await stat(targetPath);
			return true;
		} catch {
			return false;
		}
	}

	private parseZoektOutput(
		repositoryRoot: string,
		stdout: string,
		limit: number,
	): BackendSearchHit[] {
		const hits: BackendSearchHit[] = [];
		const lines = stdout.split(/\r?\n/).filter(Boolean);

		for (const line of lines) {
			const match = /^(.*):(\d+):(.*)$/.exec(line);
			if (!match) {
				continue;
			}

			hits.push({
				path: toRepositoryRelativePath(repositoryRoot, match[1]),
				startLine: Number(match[2]),
				endLine: Number(match[2]),
				snippet: match[3],
				score: scoreZoektHit(hits.length),
			});

			if (hits.length >= limit) {
				break;
			}
		}

		this.logDebug("parsed zoekt output", {
			lineCount: lines.length,
			hitCount: hits.length,
			limit,
		});

		return hits;
	}

	private async getZoektAvailability(): Promise<ZoektAvailability> {
		if (this.zoektAvailability) {
			return this.zoektAvailability;
		}

		try {
			await this.runtime.execFile(
				this.backendConfig.zoektIndexExecutable,
				["-help"],
				{
					timeout: this.runtime.availabilityTimeoutMs,
					windowsHide: true,
				},
			);
			this.logDebug("zoekt index executable available", {
				executable: this.backendConfig.zoektIndexExecutable,
				timeoutMs: this.runtime.availabilityTimeoutMs,
			});
		} catch (error) {
			this.logDebug("zoekt availability check failed for index executable",
				{
					executable: this.backendConfig.zoektIndexExecutable,
					timeoutMs: this.runtime.availabilityTimeoutMs,
					...toErrorDetails(error),
				},
			);
			this.zoektAvailability = {
				available: false,
				reason: "zoekt_unavailable",
				detail: `Zoekt index executable not available: ${this.backendConfig.zoektIndexExecutable}`,
			};
			return this.zoektAvailability;
		}

		try {
			await this.runtime.execFile(
				this.backendConfig.zoektSearchExecutable,
				["-help"],
				{
					timeout: this.runtime.availabilityTimeoutMs,
					windowsHide: true,
				},
			);
			this.logDebug("zoekt search executable available", {
				executable: this.backendConfig.zoektSearchExecutable,
				timeoutMs: this.runtime.availabilityTimeoutMs,
			});
		} catch (error) {
			this.logDebug("zoekt availability check failed for search executable",
				{
					executable: this.backendConfig.zoektSearchExecutable,
					timeoutMs: this.runtime.availabilityTimeoutMs,
					...toErrorDetails(error),
				},
			);
			this.zoektAvailability = {
				available: false,
				reason: "zoekt_unavailable",
				detail: `Zoekt search executable not available: ${this.backendConfig.zoektSearchExecutable}`,
			};
			return this.zoektAvailability;
		}

		this.zoektAvailability = {
			available: true,
			detail: "Zoekt executables available",
		};
		this.logDebug("Zoekt executables verified", {
			indexExecutable: this.backendConfig.zoektIndexExecutable,
			searchExecutable: this.backendConfig.zoektSearchExecutable,
		});
		return this.zoektAvailability;
	}
}
