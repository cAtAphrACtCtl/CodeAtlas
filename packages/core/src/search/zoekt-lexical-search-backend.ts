import { execFile } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { debugLog } from "../common/debug.js";
import type { ZoektLexicalBackendConfig } from "../configuration/config.js";
import { getRepoBuildDir, getRepoIndexDir } from "../indexer/repo-artifact-path.js";
import type { RepositoryIndexStatus } from "../metadata/metadata-store.js";
import type { RepositoryRecord } from "../registry/repository-registry.js";
import type { BackendSearchHit, BackendSearchRequest, LexicalSearchBackend } from "./lexical-search-backend.js";

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
}

const execFileAsync = promisify(execFile) as unknown as ZoektExec;
const defaultZoektRuntime: ZoektRuntimeOptions = {
  execFile: execFileAsync,
  availabilityTimeoutMs: 5_000,
  indexBuildTimeoutMs: 120_000,
  searchTimeoutMs: 30_000,
};
const defaultResultScore = 100;
const minimumResultScore = 1;

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function scoreZoektHit(resultIndex: number): number {
  return Math.max(minimumResultScore, defaultResultScore - resultIndex);
}

interface ZoektAvailability {
  available: boolean;
  detail: string;
}

export class ZoektLexicalSearchBackend implements LexicalSearchBackend {
  readonly kind = "zoekt";
  private zoektAvailability?: ZoektAvailability;
  private readonly runtime: ZoektRuntimeOptions;

  constructor(
    private readonly backendConfig: ZoektLexicalBackendConfig,
    private readonly bootstrapBackend?: LexicalSearchBackend,
    runtime?: Partial<ZoektRuntimeOptions>,
  ) {
    this.runtime = {
      ...defaultZoektRuntime,
      ...runtime,
    };

    // Development environments can still route through the bootstrap backend
    // when Zoekt is configured but not yet available locally.
    if (backendConfig.allowBootstrapFallback && !bootstrapBackend) {
      throw new Error("Zoekt bootstrap fallback is enabled but no bootstrap backend was provided");
    }
  }

  async prepareRepository(repository: RepositoryRecord): Promise<RepositoryIndexStatus> {
    const repositoryStats = await stat(repository.rootPath);
    if (!repositoryStats.isDirectory()) {
      return {
        repo: repository.name,
        backend: this.kind,
        state: "error",
        detail: "Repository root is not a directory",
      };
    }

    const availability = await this.getZoektAvailability();
    if (!availability.available) {
      return this.prepareWithFallback(repository, availability.detail);
    }

    try {
      const buildDir = getRepoBuildDir(this.backendConfig.indexRoot, repository.name, repository.rootPath);
      debugLog("zoekt", "starting zoekt prepareRepository", {
        repo: repository.name,
        executable: this.backendConfig.zoektIndexExecutable,
        buildDir,
        rootPath: repository.rootPath,
        timeoutMs: this.runtime.indexBuildTimeoutMs,
      });
      await mkdir(buildDir, { recursive: true });
      await this.runtime.execFile(
        this.backendConfig.zoektIndexExecutable,
        ["-index", buildDir, repository.rootPath],
        {
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
          timeout: this.runtime.indexBuildTimeoutMs,
        },
      );

      return {
        repo: repository.name,
        backend: this.kind,
        state: "ready",
        lastIndexedAt: new Date().toISOString(),
        detail: `Lexical index available via Zoekt at ${buildDir}`,
      };
    } catch (error) {
      debugLog("zoekt", "zoekt prepareRepository failed", {
        repo: repository.name,
        message: error instanceof Error ? error.message : String(error),
        code: (error as NodeJS.ErrnoException | undefined)?.code,
        signal: (error as { signal?: string } | undefined)?.signal,
        stderr: typeof (error as { stderr?: string } | undefined)?.stderr === "string"
          ? (error as { stderr?: string }).stderr!.split(/\r?\n/).slice(-5)
          : undefined,
      });
      const detail = error instanceof Error ? error.message : String(error);
      return this.prepareWithFallback(repository, `Zoekt index build failed: ${detail}`);
    }
  }

  async searchRepository(repository: RepositoryRecord, request: BackendSearchRequest): Promise<BackendSearchHit[]> {
    const availability = await this.getZoektAvailability();
    if (!availability.available) {
      return this.searchWithFallback(repository, request, availability.detail);
    }

    try {
      const indexDir = getRepoIndexDir(this.backendConfig.indexRoot, repository.name, repository.rootPath);
      debugLog("zoekt", "starting zoekt searchRepository", {
        repo: repository.name,
        executable: this.backendConfig.zoektSearchExecutable,
        indexDir,
        query: request.query,
        timeoutMs: this.runtime.searchTimeoutMs,
      });
      const { stdout } = await this.runtime.execFile(
        this.backendConfig.zoektSearchExecutable,
        ["-index_dir", indexDir, request.query],
        {
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
          timeout: this.runtime.searchTimeoutMs,
        },
      );

      return this.parseZoektOutput(stdout, request.limit);
    } catch (error) {
      debugLog("zoekt", "zoekt searchRepository failed", {
        repo: repository.name,
        message: error instanceof Error ? error.message : String(error),
        code: (error as NodeJS.ErrnoException | undefined)?.code,
        signal: (error as { signal?: string } | undefined)?.signal,
        stderr: typeof (error as { stderr?: string } | undefined)?.stderr === "string"
          ? (error as { stderr?: string }).stderr!.split(/\r?\n/).slice(-5)
          : undefined,
      });
      const detail = error instanceof Error ? error.message : String(error);
      return this.searchWithFallback(repository, request, `Zoekt search failed: ${detail}`);
    }
  }

  async verifyRepositoryReady(
    repository: RepositoryRecord,
    existingStatus?: RepositoryIndexStatus,
  ): Promise<{ ready: boolean; state?: "stale" | "error"; detail?: string }> {
    const configuredBackend = existingStatus?.configuredBackend ?? existingStatus?.backend;
    if (configuredBackend && configuredBackend !== this.kind) {
      return {
        ready: false,
        state: "stale",
        detail: `Stored lexical status was prepared for backend ${configuredBackend}, but active backend is ${this.kind}`,
      };
    }

    if (existingStatus?.backend && existingStatus.backend !== this.kind) {
      if (this.backendConfig.allowBootstrapFallback && this.bootstrapBackend?.verifyRepositoryReady) {
        return this.bootstrapBackend.verifyRepositoryReady(repository, existingStatus);
      }

      return {
        ready: false,
        state: "stale",
        detail: `Stored lexical status uses fallback backend ${existingStatus.backend}, but no active readiness verifier is available for it`,
      };
    }

    const availability = await this.getZoektAvailability();
    if (!availability.available) {
      return {
        ready: false,
        state: "stale",
        detail: availability.detail,
      };
    }

    const indexDir = getRepoIndexDir(this.backendConfig.indexRoot, repository.name, repository.rootPath);

    try {
      const directoryStats = await stat(indexDir);
      if (!directoryStats.isDirectory()) {
        return {
          ready: false,
          state: "stale",
          detail: `Zoekt index path is not a directory for repository ${repository.name}: ${indexDir}`,
        };
      }

      const entries = await readdir(indexDir, { withFileTypes: true });
      const hasShardFiles = entries.some((entry) => entry.isFile() && entry.name.endsWith(".zoekt"));

      if (!hasShardFiles) {
        return {
          ready: false,
          state: "stale",
          detail: `Zoekt index directory has no shard files for repository ${repository.name}: ${indexDir}`,
        };
      }

      return { ready: true };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
        return {
          ready: false,
          state: "stale",
          detail: `Zoekt index directory is missing for repository ${repository.name}: ${indexDir}`,
        };
      }

      return {
        ready: false,
        state: "error",
        detail: `Unable to inspect Zoekt index directory for repository ${repository.name}: ${detail}`,
      };
    }
  }

  private async withBootstrapFallback<T>(
    detail: string,
    fallbackAction: () => Promise<T>,
    noFallbackAction: () => T | Promise<T>,
  ): Promise<T> {
    if (this.backendConfig.allowBootstrapFallback && this.bootstrapBackend) {
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
      () => this.bootstrapBackend!.searchRepository(repository, request),
      () => {
        throw new Error(detail);
      },
    );
  }

  private async prepareWithFallback(repository: RepositoryRecord, detail: string): Promise<RepositoryIndexStatus> {
    return this.withBootstrapFallback(
      detail,
      async () => {
        const fallbackStatus = await this.bootstrapBackend!.prepareRepository(repository);
        return {
          ...fallbackStatus,
          detail: fallbackStatus.detail
            ? `${detail}; using bootstrap fallback: ${fallbackStatus.detail}`
            : `${detail}; using bootstrap fallback backend`,
        };
      },
      () => ({
        repo: repository.name,
        backend: this.kind,
        state: "error",
        detail,
      }),
    );
  }

  private parseZoektOutput(stdout: string, limit: number): BackendSearchHit[] {
    const hits: BackendSearchHit[] = [];
    const lines = stdout.split(/\r?\n/).filter(Boolean);

    for (const line of lines) {
      const match = /^(.*):(\d+):(.*)$/.exec(line);
      if (!match) {
        continue;
      }

      hits.push({
        path: toPosixPath(match[1]),
        startLine: Number(match[2]),
        endLine: Number(match[2]),
        snippet: match[3],
        score: scoreZoektHit(hits.length),
      });

      if (hits.length >= limit) {
        break;
      }
    }

    return hits;
  }

  private async getZoektAvailability(): Promise<ZoektAvailability> {
    if (this.zoektAvailability) {
      return this.zoektAvailability;
    }

    try {
      await this.runtime.execFile(this.backendConfig.zoektIndexExecutable, ["-help"], {
        timeout: this.runtime.availabilityTimeoutMs,
        windowsHide: true,
      });
    } catch (error) {
      debugLog("zoekt", "zoekt availability check failed for index executable", {
        executable: this.backendConfig.zoektIndexExecutable,
        timeoutMs: this.runtime.availabilityTimeoutMs,
        message: error instanceof Error ? error.message : String(error),
        code: (error as NodeJS.ErrnoException | undefined)?.code,
        signal: (error as { signal?: string } | undefined)?.signal,
      });
      this.zoektAvailability = {
        available: false,
        detail: `Zoekt index executable not available: ${this.backendConfig.zoektIndexExecutable}`,
      };
      return this.zoektAvailability;
    }

    try {
      await this.runtime.execFile(this.backendConfig.zoektSearchExecutable, ["-help"], {
        timeout: this.runtime.availabilityTimeoutMs,
        windowsHide: true,
      });
    } catch (error) {
      debugLog("zoekt", "zoekt availability check failed for search executable", {
        executable: this.backendConfig.zoektSearchExecutable,
        timeoutMs: this.runtime.availabilityTimeoutMs,
        message: error instanceof Error ? error.message : String(error),
        code: (error as NodeJS.ErrnoException | undefined)?.code,
        signal: (error as { signal?: string } | undefined)?.signal,
      });
      this.zoektAvailability = {
        available: false,
        detail: `Zoekt search executable not available: ${this.backendConfig.zoektSearchExecutable}`,
      };
      return this.zoektAvailability;
    }

    this.zoektAvailability = {
      available: true,
      detail: "Zoekt executables available",
    };
    return this.zoektAvailability;
  }
}
