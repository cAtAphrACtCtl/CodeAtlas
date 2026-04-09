import type { SymbolRecord, SymbolSearchRequest } from "../contracts/search.js";
import { getLogger, type Logger } from "../logging/logger.js";
import type { RepositoryRecord } from "../registry/repository-registry.js";
import type { BackendSearchHit, LexicalSearchBackend } from "./lexical-search-backend.js";

const identifierPattern = /[$A-Z_a-z][\w$]*/g;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildBackendQuery(
	request: SymbolSearchRequest,
	backendKind: string,
): string {
	if (backendKind === "zoekt") {
		return `sym:${request.query}`;
	}

	const escapedQuery = escapeRegExp(request.query);
	return request.exact ? `\\b${escapedQuery}\\b` : escapedQuery;
}

function inferSymbolNameFromSnippet(
	snippet: string,
	query: string,
	exact: boolean,
): string {
	const candidates = snippet.match(identifierPattern) ?? [];
	const loweredQuery = query.toLowerCase();

	const exactMatch = candidates.find(
		(candidate) => candidate.toLowerCase() === loweredQuery,
	);
	if (exactMatch) {
		return exactMatch;
	}

	if (exact) {
		return candidates[0] ?? query;
	}

	const prefixMatch = candidates.find((candidate) =>
		candidate.toLowerCase().startsWith(loweredQuery),
	);
	if (prefixMatch) {
		return prefixMatch;
	}

	const containsMatch = candidates.find((candidate) =>
		candidate.toLowerCase().includes(loweredQuery),
	);
	if (containsMatch) {
		return containsMatch;
	}

	return query;
}

function inferSymbolKind(snippet: string, name: string): SymbolRecord["kind"] {
	const escapedName = escapeRegExp(name);
	const keywordChecks: Array<[RegExp, SymbolRecord["kind"]]> = [
		[new RegExp(`\\bclass\\s+${escapedName}\\b`, "i"), "class"],
		[new RegExp(`\\binterface\\s+${escapedName}\\b`, "i"), "interface"],
		[new RegExp(`\\benum\\s+${escapedName}\\b`, "i"), "enum"],
		[new RegExp(`\\btype\\s+${escapedName}\\b`, "i"), "type_alias"],
		[new RegExp(`\\bfunction\\s+${escapedName}\\b`, "i"), "function"],
		[new RegExp(`\\b(?:const|let|var)\\s+${escapedName}\\b`, "i"), "variable"],
	];

	for (const [pattern, kind] of keywordChecks) {
		if (pattern.test(snippet)) {
			return kind;
		}
	}

	if (new RegExp(`\\b${escapedName}\\s*\\(`, "i").test(snippet)) {
		return "function";
	}

	if (new RegExp(`\\b${escapedName}\\s*:`, "i").test(snippet)) {
		return "property";
	}

	return "variable";
}

function toSymbolRecord(
	repo: string,
	hit: BackendSearchHit,
	request: SymbolSearchRequest,
): SymbolRecord {
	const name = inferSymbolNameFromSnippet(
		hit.snippet,
		request.query,
		request.exact ?? false,
	);
	return {
		repo,
		path: hit.path,
		name,
		kind: inferSymbolKind(hit.snippet, name),
		start_line: hit.startLine,
		end_line: hit.endLine,
	};
}

export function scoreSymbol(
	symbol: SymbolRecord,
	query: string,
	exact: boolean,
): number {
	const loweredName = (symbol.name ?? "").toLowerCase();
	const loweredQuery = query.toLowerCase();

	if (exact && loweredName === loweredQuery) {
		return 200;
	}

	if (loweredName === loweredQuery) {
		return 120;
	}

	if (loweredName.startsWith(loweredQuery)) {
		return 100;
	}

	if (loweredName.includes(loweredQuery)) {
		return 80;
	}

	if ((symbol.container_name ?? "").toLowerCase().includes(loweredQuery)) {
		return 40;
	}

	return 0;
}

export class SymbolSearchBackend {
	private readonly logger: Logger | undefined;

	constructor(
		private readonly lexicalSearchBackend: LexicalSearchBackend,
		private readonly fallbackSearchBackend?: LexicalSearchBackend,
	) {
		this.logger = getLogger();
	}

	private logDebug(message: string, details?: Record<string, unknown>): void {
		this.logger?.debug("symbol-search", message, { details });
	}

	async searchRepository(
		repository: RepositoryRecord,
		request: SymbolSearchRequest,
		backendKind?: string,
	): Promise<SymbolRecord[]> {
		const effectiveBackendKind = backendKind ?? this.lexicalSearchBackend.kind;
		const exactMode = request.exact ?? false;
		const backendLimit = Math.max(request.limit ?? 20, 1) * 5;
		const searchLimit = Math.min(backendLimit, 200);
		const executeSearch = async (
			searchBackend: LexicalSearchBackend,
			queryBackendKind: string,
		) =>
			searchBackend.searchRepository(repository, {
				query: buildBackendQuery(request, queryBackendKind),
				limit: searchLimit,
			});

		const materializeSymbols = (hits: BackendSearchHit[]) => {
			const symbols = hits.map((hit) =>
				toSymbolRecord(repository.name, hit, request),
			);
			let kindFilteredCount = 0;
			let exactRejectedCount = 0;
			let fuzzyRejectedCount = 0;
			const sampledEvaluations: Array<Record<string, unknown>> = [];

			const filtered = symbols
				.filter((symbol) => {
				if (
					request.kinds &&
					request.kinds.length > 0 &&
					!request.kinds.includes(symbol.kind)
				) {
					kindFilteredCount += 1;
					return false;
				}

				if (exactMode) {
					const matched =
						(symbol.name ?? "").toLowerCase() === request.query.toLowerCase();
					if (!matched) {
						exactRejectedCount += 1;
					}
					if (sampledEvaluations.length < 10) {
						sampledEvaluations.push({
							symbol: symbol.name,
							kind: symbol.kind,
							matched,
							mode: "exact",
						});
					}
					return matched;
				}

				const score = scoreSymbol(symbol, request.query, false);
				if (score <= 0) {
					fuzzyRejectedCount += 1;
				}
				if (sampledEvaluations.length < 10) {
					sampledEvaluations.push({
						symbol: symbol.name,
						kind: symbol.kind,
						score,
						mode: "fuzzy",
					});
				}
				return score > 0;
				})
				.sort(
					(left, right) =>
						scoreSymbol(right, request.query, exactMode) -
						scoreSymbol(left, request.query, exactMode),
				);

			const deduped = filtered.filter((symbol, index, allSymbols) => {
				const key = `${symbol.repo}:${symbol.path}:${symbol.start_line}:${symbol.name}`;
				return (
					allSymbols.findIndex(
						(candidate) =>
							`${candidate.repo}:${candidate.path}:${candidate.start_line}:${candidate.name}` ===
							key,
					) === index
				);
			});

			return {
				symbols,
				deduped,
				kindFilteredCount,
				exactRejectedCount,
				fuzzyRejectedCount,
				sampledEvaluations,
			};
		};

		let hits = [] as BackendSearchHit[];
		let executedBackendKind = effectiveBackendKind;
		let materialized = {
			symbols: [] as SymbolRecord[],
			deduped: [] as SymbolRecord[],
			kindFilteredCount: 0,
			exactRejectedCount: 0,
			fuzzyRejectedCount: 0,
			sampledEvaluations: [] as Array<Record<string, unknown>>,
		};

		if (effectiveBackendKind === "zoekt") {
			hits = await executeSearch(this.lexicalSearchBackend, "zoekt");
			materialized = materializeSymbols(hits);
			if (materialized.deduped.length === 0 && this.fallbackSearchBackend) {
				this.logDebug("zoekt symbol query yielded no usable results, retrying with direct grep fallback", {
					repo: repository.name,
					query: request.query,
				});
				hits = await executeSearch(this.fallbackSearchBackend, this.fallbackSearchBackend.kind);
				materialized = materializeSymbols(hits);
				executedBackendKind = this.fallbackSearchBackend.kind;
			}
		} else if (this.fallbackSearchBackend && effectiveBackendKind === this.fallbackSearchBackend.kind) {
			hits = await executeSearch(this.fallbackSearchBackend, this.fallbackSearchBackend.kind);
			materialized = materializeSymbols(hits);
			executedBackendKind = this.fallbackSearchBackend.kind;
		} else {
			hits = await executeSearch(this.lexicalSearchBackend, effectiveBackendKind);
			materialized = materializeSymbols(hits);
		}

		this.logDebug("symbol search completed", {
			repo: repository.name,
			query: request.query,
			backendKind: executedBackendKind,
			exact: exactMode,
			totalSymbols: materialized.symbols.length,
			matchedSymbols: materialized.deduped.length,
			kindFilteredCount: materialized.kindFilteredCount,
			exactRejectedCount: materialized.exactRejectedCount,
			fuzzyRejectedCount: materialized.fuzzyRejectedCount,
			sample: materialized.sampledEvaluations,
		});

		return materialized.deduped.slice(
			0,
			request.limit ?? materialized.deduped.length,
		);
	}
}
