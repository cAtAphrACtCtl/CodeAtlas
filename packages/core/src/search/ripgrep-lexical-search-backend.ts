import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { debugLog, toErrorDetails } from "../common/debug.js";
import type { RipgrepLexicalBackendConfig } from "../configuration/config.js";
import type { RepositoryIndexStatus } from "../metadata/metadata-store.js";
import type { RepositoryRecord } from "../registry/repository-registry.js";
import type {
  BackendSearchHit,
  BackendSearchRequest,
  LexicalSearchBackend,
} from "./lexical-search-backend.js";

const execFileAsync = promisify(execFile);
const skippedDirectories = new Set([".git", "node_modules", "dist", "data", ".next"]);

interface RipgrepJsonRecord {
  type: string;
  data?: {
    path?: { text?: string };
    line_number?: number;
    lines?: { text?: string };
  };
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/").replace(/^\.\//, "");
}

export class BootstrapRipgrepLexicalSearchBackend implements LexicalSearchBackend {
  readonly kind = "ripgrep";
  private rgAvailable?: boolean;

  constructor(
    private readonly backendConfig: RipgrepLexicalBackendConfig,
    private readonly maxBytesPerFile: number,
  ) {}

  async prepareRepository(repository: RepositoryRecord): Promise<RepositoryIndexStatus> {
    debugLog("ripgrep", "starting prepareRepository", {
      repo: repository.name,
      rootPath: repository.rootPath,
      executable: this.backendConfig.executable,
      fallbackToNaiveScan: this.backendConfig.fallbackToNaiveScan,
      maxBytesPerFile: this.maxBytesPerFile,
    });

    const repositoryStats = await stat(repository.rootPath);

    if (!repositoryStats.isDirectory()) {
      debugLog("ripgrep", "prepareRepository failed because root path is not a directory", {
        repo: repository.name,
        rootPath: repository.rootPath,
      });
      return {
        repo: repository.name,
        backend: this.kind,
        state: "error",
        reason: "repository_root_not_directory",
        detail: "Repository root is not a directory",
      };
    }

    const rgAvailable = await this.isRipgrepAvailable();
    if (!rgAvailable && !this.backendConfig.fallbackToNaiveScan) {
      debugLog("ripgrep", "prepareRepository failed because ripgrep is unavailable and fallback is disabled", {
        repo: repository.name,
        executable: this.backendConfig.executable,
      });
      return {
        repo: repository.name,
        backend: this.kind,
        state: "error",
        reason: "ripgrep_unavailable",
        detail: "ripgrep executable not found and fallback scanning disabled",
      };
    }

    const status: RepositoryIndexStatus = {
      repo: repository.name,
      backend: this.kind,
      state: "ready",
      reason: rgAvailable ? undefined : "ripgrep_naive_fallback",
      lastIndexedAt: new Date().toISOString(),
      detail: rgAvailable ? "Lexical search available via ripgrep" : "Lexical search available via naive fallback",
    };

    debugLog("ripgrep", "completed prepareRepository", {
      repo: repository.name,
      backend: status.backend,
      state: status.state,
      detail: status.detail,
    });

    return status;
  }

  async searchRepository(repository: RepositoryRecord, request: BackendSearchRequest): Promise<BackendSearchHit[]> {
    debugLog("ripgrep", "starting searchRepository", {
      repo: repository.name,
      query: request.query,
      limit: request.limit,
    });

    const rgAvailable = await this.isRipgrepAvailable();

    if (rgAvailable) {
      try {
        const hits = await this.searchWithRipgrep(repository, request);
        debugLog("ripgrep", "completed searchRepository with ripgrep", {
          repo: repository.name,
          query: request.query,
          limit: request.limit,
          hitCount: hits.length,
        });
        return hits;
      } catch (error) {
        debugLog("ripgrep", "ripgrep search failed", {
          repo: repository.name,
          query: request.query,
          ...toErrorDetails(error),
        });
        if (!this.backendConfig.fallbackToNaiveScan) {
          throw new Error(`ripgrep search failed for repository ${repository.name}`);
        }
      }
    }

    if (!rgAvailable) {
      debugLog("ripgrep", "searchRepository using naive fallback because ripgrep is unavailable", {
        repo: repository.name,
        query: request.query,
      });
    }

    const hits = await this.searchWithNaiveScan(repository, request);
    debugLog("ripgrep", "completed searchRepository with naive fallback", {
      repo: repository.name,
      query: request.query,
      limit: request.limit,
      hitCount: hits.length,
    });
    return hits;
  }

  async verifyRepositoryReady(): Promise<{ ready: boolean }> {
    return { ready: true };
  }

  private async isRipgrepAvailable(): Promise<boolean> {
    if (this.rgAvailable !== undefined) {
      return this.rgAvailable;
    }

    try {
      await execFileAsync(this.backendConfig.executable, ["--version"]);
      this.rgAvailable = true;
      debugLog("ripgrep", "ripgrep executable available", {
        executable: this.backendConfig.executable,
      });
    } catch (error) {
      this.rgAvailable = false;
      debugLog("ripgrep", "ripgrep executable unavailable", {
        executable: this.backendConfig.executable,
        ...toErrorDetails(error),
      });
    }

    return this.rgAvailable;
  }

  private async searchWithRipgrep(repository: RepositoryRecord, request: BackendSearchRequest): Promise<BackendSearchHit[]> {
    const args = [
      "--json",
      "--line-number",
      "--smart-case",
      "--hidden",
      "--max-filesize",
      String(this.maxBytesPerFile),
      "--glob",
      "!.git",
      "--glob",
      "!node_modules",
      "--glob",
      "!dist",
      "--glob",
      "!data",
      "--glob",
      "!.next",
      request.query,
      ".",
    ];

    const { stdout } = await execFileAsync(this.backendConfig.executable, args, {
      cwd: repository.rootPath,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });

    const hits: BackendSearchHit[] = [];
    const records = stdout.split(/\r?\n/).filter(Boolean);

    for (const [index, recordText] of records.entries()) {
      const record = JSON.parse(recordText) as RipgrepJsonRecord;
      if (record.type !== "match") {
        continue;
      }

      const relativePath = record.data?.path?.text;
      const lineNumber = record.data?.line_number;
      const lineText = record.data?.lines?.text?.replace(/\r?\n$/, "") ?? "";

      if (!relativePath || !lineNumber) {
        continue;
      }

      hits.push({
        path: toPosixPath(relativePath),
        startLine: lineNumber,
        endLine: lineNumber,
        snippet: lineText,
        score: Math.max(1, 100 - index),
      });

      if (hits.length >= request.limit) {
        break;
      }
    }

    debugLog("ripgrep", "parsed ripgrep output", {
      repo: repository.name,
      query: request.query,
      recordCount: records.length,
      hitCount: hits.length,
    });

    return hits;
  }

  private async searchWithNaiveScan(repository: RepositoryRecord, request: BackendSearchRequest): Promise<BackendSearchHit[]> {
    const matches: BackendSearchHit[] = [];
    const files = await this.walkRepository(repository.rootPath);
    const loweredQuery = request.query.toLowerCase();

    for (const filePath of files) {
      if (matches.length >= request.limit) {
        break;
      }

      const fileStats = await stat(filePath);
      if (!fileStats.isFile() || fileStats.size > this.maxBytesPerFile) {
        continue;
      }

      const buffer = await readFile(filePath);
      if (buffer.includes(0)) {
        continue;
      }

      const content = buffer.toString("utf8");
      const lines = content.split(/\r?\n/);
      const relativePath = toPosixPath(path.relative(repository.rootPath, filePath));

      for (const [lineIndex, line] of lines.entries()) {
        if (!line.toLowerCase().includes(loweredQuery)) {
          continue;
        }

        matches.push({
          path: relativePath,
          startLine: lineIndex + 1,
          endLine: lineIndex + 1,
          snippet: line,
          score: Math.max(1, 60 - matches.length),
        });

        if (matches.length >= request.limit) {
          break;
        }
      }
    }

    debugLog("ripgrep", "completed naive scan", {
      repo: repository.name,
      query: request.query,
      scannedFileCount: files.length,
      hitCount: matches.length,
    });

    return matches;
  }

  private async walkRepository(rootPath: string): Promise<string[]> {
    const results: string[] = [];
    const queue = [rootPath];

    while (queue.length > 0) {
      const currentDirectory = queue.shift();
      if (!currentDirectory) {
        continue;
      }

      const entries = await readdir(currentDirectory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!skippedDirectories.has(entry.name)) {
            queue.push(path.join(currentDirectory, entry.name));
          }

          continue;
        }

        if (entry.isFile()) {
          results.push(path.join(currentDirectory, entry.name));
        }
      }
    }

    debugLog("ripgrep", "walked repository for naive scan", {
      rootPath,
      fileCount: results.length,
    });

    return results;
  }
}

export { BootstrapRipgrepLexicalSearchBackend as RipgrepLexicalSearchBackend };
