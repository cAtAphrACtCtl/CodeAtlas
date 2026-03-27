import { mkdir } from "node:fs/promises";
import path from "node:path";

import { debugLog, toErrorDetails } from "../common/debug.js";
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
		const indexPath = this.getIndexPath(repo);

		try {
			const document = await readJsonFile<SymbolIndexDocument>(indexPath, {
				repo,
				symbols: [],
			});

			const symbols = Array.isArray(document.symbols)
				? document.symbols.filter(isSymbolRecord)
				: [];
			debugLog("symbol-index", "loaded symbols", {
				repo,
				indexPath,
				symbolCount: symbols.length,
			});
			return symbols;
		} catch (error) {
			debugLog("symbol-index", "failed to load symbols", {
				repo,
				indexPath,
				...toErrorDetails(error),
			});
			throw error;
		}
	}

	async setSymbols(repo: string, symbols: SymbolRecord[]): Promise<void> {
		const indexPath = this.getIndexPath(repo);
		await mkdir(path.dirname(indexPath), { recursive: true });
		await writeJsonFile(indexPath, {
			repo,
			symbols,
		});
		debugLog("symbol-index", "stored symbols", {
			repo,
			indexPath,
			symbolCount: symbols.length,
		});
	}

	private getIndexPath(repo: string): string {
		return path.join(this.indexRoot, "symbols", `${toSafeFileName(repo)}.json`);
	}
}
