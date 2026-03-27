import type { ReadSourceResponse } from "../contracts/search.js";
import type { RepositoryRecord } from "../registry/repository-registry.js";

export interface SourceReader {
	readRange(
		repository: RepositoryRecord,
		relativePath: string,
		startLine: number,
		endLine: number,
	): Promise<ReadSourceResponse>;
}
