import type { SymbolRecord, SymbolSearchRequest } from "../contracts/search.js";
import type { SymbolIndexStore } from "./symbol-index-store.js";

export function scoreSymbol(symbol: SymbolRecord, query: string, exact: boolean): number {
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

  async searchRepository(repo: string, request: SymbolSearchRequest): Promise<SymbolRecord[]> {
    const symbols = await this.symbolIndexStore.getSymbols(repo);
    const filtered = symbols
      .filter((symbol) => {
        if (request.kinds && request.kinds.length > 0 && !request.kinds.includes(symbol.kind)) {
          return false;
        }

        return scoreSymbol(symbol, request.query, request.exact ?? false) > 0;
      })
      .sort((left, right) => scoreSymbol(right, request.query, request.exact ?? false) - scoreSymbol(left, request.query, request.exact ?? false));

    return filtered.slice(0, request.limit ?? filtered.length);
  }
}