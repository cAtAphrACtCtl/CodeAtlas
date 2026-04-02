import { createHash } from "node:crypto";
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { toErrorDetails } from "../common/debug.js";
import { readJsonFile, writeJsonFile } from "../common/json-file.js";
import type { SymbolRecord } from "../contracts/search.js";
import { getLogger, type Logger } from "../logging/logger.js";

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
	deleteSymbols?(repo: string): Promise<void>;
}

function toSafeFileName(repo: string): string {
	return repo.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

function symbolFileName(repo: string): string {
	const hash = createHash("sha256").update(repo).digest("hex").slice(0, 8);
	return `${toSafeFileName(repo)}-${hash}.json`;
}

export function getSymbolIndexPath(indexRoot: string, repo: string): string {
	return path.join(indexRoot, "symbols", symbolFileName(repo));
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

export class FileSymbolIndexStore implements SymbolIndexStore {
	private readonly logger: Logger | undefined;

	constructor(private readonly indexRoot: string) {
		this.logger = getLogger();
	}

	private logDebug(message: string, details?: Record<string, unknown>): void {
		this.logger?.debug("symbol-index", message, { details });
	}

	async getSymbols(repo: string): Promise<SymbolRecord[]> {
		const indexPath = this.getIndexPath(repo);
		const legacyIndexPath = this.getLegacyIndexPath(repo);
		const preferredIndexPath = (await fileExists(indexPath))
			? indexPath
			: legacyIndexPath;

		try {
			const document = await readJsonFile<SymbolIndexDocument>(preferredIndexPath, {
				repo,
				symbols: [],
			});

			const symbols = Array.isArray(document.symbols)
				? document.symbols.filter(isSymbolRecord)
				: [];
			this.logDebug("loaded symbols", {
				repo,
				indexPath: preferredIndexPath,
				symbolCount: symbols.length,
			});
			return symbols;
		} catch (error) {
			this.logDebug("failed to load symbols", {
				repo,
				indexPath: preferredIndexPath,
				...toErrorDetails(error),
			});
			throw error;
		}
	}

	async setSymbols(repo: string, symbols: SymbolRecord[]): Promise<void> {
		const indexPath = this.getIndexPath(repo);
		const legacyIndexPath = this.getLegacyIndexPath(repo);
		await mkdir(path.dirname(indexPath), { recursive: true });
		await writeJsonFile(indexPath, {
			repo,
			symbols,
		});
		if (legacyIndexPath !== indexPath) {
			await rm(legacyIndexPath, { force: true });
		}
		this.logDebug("stored symbols", {
			repo,
			indexPath,
			symbolCount: symbols.length,
		});
	}

	async deleteSymbols(repo: string): Promise<void> {
		const indexPath = this.getIndexPath(repo);
		const legacyIndexPath = this.getLegacyIndexPath(repo);
		await rm(indexPath, { force: true });
		if (legacyIndexPath !== indexPath) {
			await rm(legacyIndexPath, { force: true });
		}
		this.logDebug("deleted symbols", {
			repo,
			indexPath,
		});
	}

	private getIndexPath(repo: string): string {
		return getSymbolIndexPath(this.indexRoot, repo);
	}

	private getLegacyIndexPath(repo: string): string {
		return path.join(this.indexRoot, "symbols", `${toSafeFileName(repo)}.json`);
	}
}
