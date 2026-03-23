import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { ZoektLexicalBackendConfig } from "../configuration/config.js";
import type { RepositoryIndexStatus } from "../metadata/metadata-store.js";
import type { RepositoryRecord } from "../registry/repository-registry.js";
import type { BackendSearchHit, BackendSearchRequest, LexicalSearchBackend } from "./lexical-search-backend.js";

const execFileAsync = promisify(execFile);
const processTimeoutMs = 30_000;
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

  constructor(
    private readonly backendConfig: ZoektLexicalBackendConfig,
    private readonly bootstrapBackend?: LexicalSearchBackend,
  ) {
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
      await mkdir(this.backendConfig.indexRoot, { recursive: true });
      await execFileAsync(
        this.backendConfig.zoektIndexExecutable,
        ["-index", this.backendConfig.indexRoot, repository.rootPath],
        {
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
          timeout: processTimeoutMs,
        },
      );

      return {
        repo: repository.name,
        backend: this.kind,
        state: "ready",
        lastIndexedAt: new Date().toISOString(),
        detail: `Lexical index available via Zoekt at ${this.backendConfig.indexRoot}`,
      };
    } catch (error) {
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
      const { stdout } = await execFileAsync(
        this.backendConfig.zoektSearchExecutable,
        ["-index_dir", this.backendConfig.indexRoot, request.query],
        {
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
          timeout: processTimeoutMs,
        },
      );

      return this.parseZoektOutput(stdout, request.limit);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return this.searchWithFallback(repository, request, `Zoekt search failed: ${detail}`);
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
      await execFileAsync(this.backendConfig.zoektIndexExecutable, ["-help"], { timeout: processTimeoutMs, windowsHide: true });
    } catch {
      this.zoektAvailability = {
        available: false,
        detail: `Zoekt index executable not available: ${this.backendConfig.zoektIndexExecutable}`,
      };
      return this.zoektAvailability;
    }

    try {
      await execFileAsync(this.backendConfig.zoektSearchExecutable, ["-help"], { timeout: processTimeoutMs, windowsHide: true });
    } catch {
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