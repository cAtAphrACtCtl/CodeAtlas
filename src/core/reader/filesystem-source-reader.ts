import { readFile } from "node:fs/promises";
import path from "node:path";

import { toErrorDetails } from "../common/debug.js";
import { CodeAtlasError, invariant } from "../common/errors.js";
import type { ReadSourceResponse } from "../contracts/search.js";
import { getLogger, type Logger } from "../logging/logger.js";
import type { RepositoryRecord } from "../registry/repository-registry.js";
import type { SourceReader } from "./source-reader.js";

function toPosixPath(filePath: string): string {
	return filePath.split(path.sep).join("/");
}

export class FileSystemSourceReader implements SourceReader {
	private readonly logger: Logger | undefined;

	constructor() {
		this.logger = getLogger();
	}

	private logDebug(message: string, details?: Record<string, unknown>): void {
		this.logger?.debug("source-reader", message, { details });
	}

	async readRange(
		repository: RepositoryRecord,
		relativePath: string,
		startLine: number,
		endLine: number,
	): Promise<ReadSourceResponse> {
		this.logDebug("starting readRange", {
			repo: repository.name,
			relativePath,
			startLine,
			endLine,
		});

		invariant(startLine >= 1, "start_line must be >= 1");
		invariant(endLine >= startLine, "end_line must be >= start_line");

		const resolvedPath = path.resolve(repository.rootPath, relativePath);
		const relativeFromRoot = path.relative(repository.rootPath, resolvedPath);

		if (
			relativeFromRoot.startsWith("..") ||
			path.isAbsolute(relativeFromRoot)
		) {
			this.logDebug("readRange rejected path escape", {
				repo: repository.name,
				relativePath,
				resolvedPath,
			});
			throw new CodeAtlasError("Requested path escapes repository root");
		}

		try {
			const fileContents = await readFile(resolvedPath, "utf8");
			const lines = fileContents.split(/\r?\n/);
			invariant(
				startLine <= lines.length,
				`start_line exceeds file length (${lines.length})`,
			);
			const safeEndLine = Math.min(endLine, lines.length);
			const content = lines.slice(startLine - 1, safeEndLine).join("\n");

			this.logDebug("completed readRange", {
				repo: repository.name,
				relativePath: toPosixPath(relativeFromRoot),
				lineCount: lines.length,
				returnedStartLine: startLine,
				returnedEndLine: safeEndLine,
			});

			return {
				repo: repository.name,
				path: toPosixPath(relativeFromRoot),
				start_line: startLine,
				end_line: safeEndLine,
				content,
			};
		} catch (error) {
			this.logDebug("readRange failed", {
				repo: repository.name,
				relativePath,
				resolvedPath,
				...toErrorDetails(error),
			});
			throw error;
		}
	}
}
