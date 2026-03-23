import type { LexicalBackendConfig } from "../configuration/config.js";
import { BootstrapRipgrepLexicalSearchBackend } from "./ripgrep-lexical-search-backend.js";
import type { LexicalSearchBackend } from "./lexical-search-backend.js";
import { ZoektLexicalSearchBackend } from "./zoekt-lexical-search-backend.js";

// Keep lexical backend selection centralized so SearchService and MCP contracts
// stay stable while the implementation moves from bootstrap ripgrep to Zoekt.
export function createLexicalSearchBackend(
  config: LexicalBackendConfig,
  maxBytesPerFile: number,
): LexicalSearchBackend {
  if (config.kind === "zoekt") {
    return new ZoektLexicalSearchBackend(
      config,
      new BootstrapRipgrepLexicalSearchBackend(config.bootstrapFallback, maxBytesPerFile),
    );
  }

  return new BootstrapRipgrepLexicalSearchBackend(config, maxBytesPerFile);
}