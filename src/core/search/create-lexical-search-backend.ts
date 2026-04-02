import type { IndexingConfig, LexicalBackendConfig } from "../configuration/config.js";
import type { LexicalSearchBackend } from "./lexical-search-backend.js";
import { BootstrapRipgrepLexicalSearchBackend } from "./ripgrep-lexical-search-backend.js";
import { ZoektLexicalSearchBackend } from "./zoekt-lexical-search-backend.js";

// Keep lexical backend selection centralized so SearchService and MCP contracts
// stay stable while the implementation moves from bootstrap ripgrep to Zoekt.
export function createLexicalSearchBackend(
	config: LexicalBackendConfig,
	maxBytesPerFile: number,
	indexing?: IndexingConfig,
): LexicalSearchBackend {
	if (config.kind === "zoekt") {
		return new ZoektLexicalSearchBackend(
			config,
			new BootstrapRipgrepLexicalSearchBackend(
				config.bootstrapFallback,
				maxBytesPerFile,
			),
			{
				maxBytesPerFile,
				...(indexing?.indexBuildTimeoutMs
					? { indexBuildTimeoutMs: indexing.indexBuildTimeoutMs }
					: {}),
			},
		);
	}

	return new BootstrapRipgrepLexicalSearchBackend(config, maxBytesPerFile);
}
