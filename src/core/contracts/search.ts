export type SearchSourceType = "lexical" | "semantic" | "hybrid";

export interface SearchResult {
	repo: string;
	path: string;
	start_line: number;
	end_line: number;
	snippet: string;
	score: number;
	source_type: SearchSourceType;
}

export interface SearchRequest {
	query: string;
	repos?: string[];
	limit?: number;
}

export interface SearchResponse {
	query: string;
	source_type: SearchSourceType;
	results: SearchResult[];
	not_implemented?: boolean;
	message?: string;
}

export type SymbolKind =
	| "class"
	| "enum"
	| "function"
	| "interface"
	| "method"
	| "property"
	| "type_alias"
	| "variable";

export interface SymbolRecord {
	repo: string;
	path: string;
	name: string;
	kind: SymbolKind;
	start_line: number;
	end_line: number;
	container_name?: string;
}

export interface SymbolSearchRequest {
	query: string;
	repos?: string[];
	kinds?: SymbolKind[];
	limit?: number;
	exact?: boolean;
}

export interface SymbolSearchResponse {
	query: string;
	results: SymbolRecord[];
}

export interface ReadSourceRequest {
	repo: string;
	path: string;
	start_line: number;
	end_line: number;
}

export interface ReadSourceResponse {
	repo: string;
	path: string;
	start_line: number;
	end_line: number;
	content: string;
}
