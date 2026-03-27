import { debugLog } from "../common/debug.js";
import type { SymbolRecord, SymbolSearchRequest } from "../contracts/search.js";
import type { SymbolIndexStore } from "./symbol-index-store.js";

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
	constructor(private readonly symbolIndexStore: SymbolIndexStore) {}

	async searchRepository(
		repo: string,
		request: SymbolSearchRequest,
	): Promise<SymbolRecord[]> {
		const symbols = await this.symbolIndexStore.getSymbols(repo);
		const exactMode = request.exact ?? false;
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

		debugLog("symbol-search", "symbol search completed", {
			repo,
			query: request.query,
			exact: exactMode,
			totalSymbols: symbols.length,
			matchedSymbols: filtered.length,
			kindFilteredCount,
			exactRejectedCount,
			fuzzyRejectedCount,
			sample: sampledEvaluations,
		});

		return filtered.slice(0, request.limit ?? filtered.length);
	}
}
