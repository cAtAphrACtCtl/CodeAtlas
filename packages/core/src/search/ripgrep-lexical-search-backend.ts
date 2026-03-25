import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

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
    const repositoryStats = await stat(repository.rootPath);

    if (!repositoryStats.isDirectory()) {
      return {
        repo: repository.name,
        backend: this.kind,
        state: "error",
        detail: "Repository root is not a directory",
      };
    }

    const rgAvailable = await this.isRipgrepAvailable();
    if (!rgAvailable && !this.backendConfig.fallbackToNaiveScan) {
      return {
        repo: repository.name,
        backend: this.kind,
        state: "error",
        detail: "ripgrep executable not found and fallback scanning disabled",
      };
    }

    return {
      repo: repository.name,
      backend: this.kind,
      state: "ready",
      lastIndexedAt: new Date().toISOString(),
      detail: rgAvailable ? "Lexical search available via ripgrep" : "Lexical search available via naive fallback",
    };
  }

  async searchRepository(repository: RepositoryRecord, request: BackendSearchRequest): Promise<BackendSearchHit[]> {
    const rgAvailable = await this.isRipgrepAvailable();

    if (rgAvailable) {
      try {
        return await this.searchWithRipgrep(repository, request);
      } catch {
        if (!this.backendConfig.fallbackToNaiveScan) {
          throw new Error(`ripgrep search failed for repository ${repository.name}`);
        }
      }
    }

    return this.searchWithNaiveScan(repository, request);
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
    } catch {
      this.rgAvailable = false;
    }

    return this.rgAvailable;
  }

  private async searchWithRipgrep(repository: RepositoryRecord, request: BackendSearchRequest): Promise<BackendSearchHit[]> {
    const args = [
      "--json",
      "--line-number",
      "--smart-case",
      "--hidden",
      "--glob",
      "!.git",
      "--glob",
      "!node_modules",
      "--glob",
      "!dist",
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

    return results;
  }
}

export { BootstrapRipgrepLexicalSearchBackend as RipgrepLexicalSearchBackend };
