import { mkdir } from "node:fs/promises";
import path from "node:path";

import { readJsonFile, writeJsonFile } from "../common/json-file.js";
import type { SymbolRecord } from "../contracts/search.js";

interface SymbolIndexDocument {
  repo: string;
  symbols: SymbolRecord[];
}

function isSymbolRecord(value: unknown): value is SymbolRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<SymbolRecord>;
  return (
    typeof candidate.repo === "string" &&
    typeof candidate.path === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.kind === "string" &&
    typeof candidate.start_line === "number" &&
    typeof candidate.end_line === "number"
  );
}

export interface SymbolIndexStore {
  getSymbols(repo: string): Promise<SymbolRecord[]>;
  setSymbols(repo: string, symbols: SymbolRecord[]): Promise<void>;
}

function toSafeFileName(repo: string): string {
  return repo.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

export class FileSymbolIndexStore implements SymbolIndexStore {
  constructor(private readonly indexRoot: string) {}

  async getSymbols(repo: string): Promise<SymbolRecord[]> {
    const document = await readJsonFile<SymbolIndexDocument>(this.getIndexPath(repo), {
      repo,
      symbols: [],
    });

    return Array.isArray(document.symbols) ? document.symbols.filter(isSymbolRecord) : [];
  }

  async setSymbols(repo: string, symbols: SymbolRecord[]): Promise<void> {
    await mkdir(path.dirname(this.getIndexPath(repo)), { recursive: true });
    await writeJsonFile(this.getIndexPath(repo), {
      repo,
      symbols,
    });
  }

  private getIndexPath(repo: string): string {
    return path.join(this.indexRoot, "symbols", `${toSafeFileName(repo)}.json`);
  }
}