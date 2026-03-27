import path from "node:path";

import type { LexicalBackendConfig, RipgrepLexicalBackendConfig, ZoektLexicalBackendConfig } from "../configuration/config.js";
import type { RepositoryIndexStatus } from "../metadata/metadata-store.js";

export interface RepositoryIndexDiagnostics {
  severity: "info" | "warning" | "error";
  summary: string;
  impact?: string;
  causes?: string[];
  remedies?: string[];
}

export type DiagnosedRepositoryIndexStatus = RepositoryIndexStatus & {
  diagnostics?: RepositoryIndexDiagnostics;
};

function looksLikeExecutablePath(value: string): boolean {
  return path.isAbsolute(value) || value.startsWith(".") || value.includes("/") || value.includes("\\");
}

function summarizeRuntimeHint(config: LexicalBackendConfig): string[] {
  if (config.kind !== "zoekt") {
    return [];
  }

  const indexExecutable = config.zoektIndexExecutable;
  const searchExecutable = config.zoektSearchExecutable;
  const windowsExecutables = indexExecutable.toLowerCase().endsWith(".exe") || searchExecutable.toLowerCase().endsWith(".exe");

  if (process.platform === "win32") {
    return windowsExecutables
      ? []
      : ["The current process is running on Windows, but the configured Zoekt executables do not look like Windows binaries."];
  }

  return windowsExecutables
    ? ["The current process is not running on Windows, but the configured Zoekt executables look like Windows binaries."]
    : [];
}

function normalizeRemedy(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

function createZoektUnavailableDiagnostics(
  status: RepositoryIndexStatus,
  config: ZoektLexicalBackendConfig,
): RepositoryIndexDiagnostics {
  const fallbackActive = status.backend !== "zoekt";
  const remedies = [
    "Verify that `CODEATLAS_CONFIG` points at the intended configuration file for this runtime.",
    "Check that `zoektIndexExecutable` and `zoektSearchExecutable` exist and are executable from the same runtime as the MCP server.",
    fallbackActive
      ? "If Zoekt should be required here, disable bootstrap fallback after the environment is fixed so the server fails loudly instead of silently degrading."
      : "Re-run `refresh_repo` after fixing the Zoekt executable paths.",
  ];

  if (process.platform === "win32") {
    remedies.splice(
      1,
      0,
      `Install or repair Zoekt with ${normalizeRemedy("npm run zoekt:install:windows")}. If upstream build fails, use ${normalizeRemedy("npm run zoekt:install:windows:source")}.`,
      "Use `config/codeatlas.windows.example.json` as the Windows-native configuration reference.",
    );
  } else {
    remedies.splice(
      1,
      0,
      "Use `config/codeatlas.wsl.example.json` as the WSL/Linux configuration reference.",
    );
  }

  const causes = [
    `Configured Zoekt index executable: ${config.zoektIndexExecutable}`,
    `Configured Zoekt search executable: ${config.zoektSearchExecutable}`,
    ...summarizeRuntimeHint(config),
  ];

  return {
    severity: fallbackActive ? "warning" : "error",
    summary: fallbackActive
      ? "Zoekt is not available in the current runtime, so CodeAtlas is using the bootstrap fallback backend instead."
      : "Zoekt is not available in the current runtime, so lexical indexing cannot proceed.",
    impact: fallbackActive
      ? "Results may still work through the fallback backend, but this environment is not using the intended Zoekt-first path."
      : "Repository registration or refresh cannot complete with the configured lexical backend until Zoekt is fixed.",
    causes,
    remedies,
  };
}

function createRipgrepUnavailableDiagnostics(
  status: RepositoryIndexStatus,
  config: RipgrepLexicalBackendConfig,
): RepositoryIndexDiagnostics {
  const fallbackEnabled = config.fallbackToNaiveScan;
  return {
    severity: fallbackEnabled ? "warning" : "error",
    summary: fallbackEnabled
      ? "ripgrep is not available, so CodeAtlas is using the slower naive file scan fallback."
      : "ripgrep is not available and fallback scanning is disabled.",
    impact: fallbackEnabled
      ? "Lexical search can still run, but query latency and large-repository behavior may be significantly worse."
      : "Lexical indexing and search cannot proceed until ripgrep is installed or fallback scanning is enabled.",
    causes: [
      `Configured ripgrep executable: ${config.executable}`,
      looksLikeExecutablePath(config.executable)
        ? "The configured ripgrep path looks explicit; confirm that the file exists for this runtime."
        : "The configured ripgrep executable must be discoverable on PATH for this runtime.",
    ],
    remedies: [
      "Install ripgrep or update the configured executable path.",
      "Verify that the MCP server inherits the expected PATH in the current shell or host process.",
      fallbackEnabled
        ? "Keep fallback scanning only as a development or troubleshooting path; prefer restoring ripgrep for normal use."
        : "Enable `fallbackToNaiveScan` temporarily only if a slower development fallback is acceptable.",
    ],
  };
}

function createFallbackActiveDiagnostics(status: RepositoryIndexStatus): RepositoryIndexDiagnostics {
  return {
    severity: "warning",
    summary: `Configured lexical backend is ${status.configuredBackend}, but the active backend for this repository is ${status.backend}.`,
    impact: "CodeAtlas is running in a degraded retrieval mode for this repository. Results may still be available, but they are not coming from the intended backend.",
    causes: [
      status.detail ?? "The active backend reported a fallback condition.",
    ],
    remedies: [
      "Inspect the backend detail message and restore the configured backend before treating the environment as production-ready.",
      "Run `get_index_status` again after the fix to verify that `backend` matches `configuredBackend`.",
    ],
  };
}

function createIndexingDiagnostics(status: RepositoryIndexStatus): RepositoryIndexDiagnostics {
  return {
    severity: "info",
    summary: "Repository refresh is in progress.",
    impact: "Lexical and symbol data may still reflect the last completed refresh until the current refresh finishes.",
    causes: [status.detail ?? "Repository refresh in progress"],
    remedies: ["Wait for the current refresh to complete, then call `get_index_status` again."],
  };
}

function createStaleDiagnostics(status: RepositoryIndexStatus): RepositoryIndexDiagnostics {
  return {
    severity: "warning",
    summary: "Repository index is stale and should be refreshed before relying on results.",
    impact: "Search results may miss recent file changes until the repository is refreshed.",
    causes: [status.detail ?? "Repository contents changed and require refresh"],
    remedies: ["Run `refresh_repo` for this repository.", "If this keeps recurring unexpectedly, inspect file update handling in the current runtime."],
  };
}

function createSymbolDiagnostics(status: RepositoryIndexStatus): RepositoryIndexDiagnostics {
  return {
    severity: status.state === "ready" ? "warning" : "error",
    summary: "Lexical indexing succeeded, but symbol indexing is not ready.",
    impact: status.state === "ready"
      ? "`code_search` can still work, but `find_symbol` may be stale or unavailable for this repository."
      : "Both lexical and symbol workflows may be affected until refresh succeeds.",
    causes: [status.detail ?? `Symbol state is ${status.symbolState}.`],
    remedies: ["Run `refresh_repo` again after fixing the symbol extraction issue.", "Use `code_search` plus `read_source` as a fallback while symbol indexing is unavailable."],
  };
}

function createErrorDiagnostics(status: RepositoryIndexStatus): RepositoryIndexDiagnostics {
  return {
    severity: "error",
    summary: "Repository index is in an error state.",
    impact: "The current repository cannot be treated as ready for normal retrieval until the error is fixed.",
    causes: [status.detail ?? "Unknown indexing error"],
    remedies: ["Fix the reported environment or repository issue.", "Re-run `refresh_repo` after the fix to verify recovery."],
  };
}

export function attachIndexStatusDiagnostics(
  status: RepositoryIndexStatus,
  lexicalBackendConfig: LexicalBackendConfig,
): DiagnosedRepositoryIndexStatus {
  let diagnostics: RepositoryIndexDiagnostics | undefined;

  if (status.reason === "zoekt_unavailable" && lexicalBackendConfig.kind === "zoekt") {
    diagnostics = createZoektUnavailableDiagnostics(status, lexicalBackendConfig);
  } else if ((status.reason === "ripgrep_unavailable" || status.reason === "ripgrep_naive_fallback") && lexicalBackendConfig.kind === "ripgrep") {
    diagnostics = createRipgrepUnavailableDiagnostics(status, lexicalBackendConfig);
  } else if (status.reason === "configured_backend_mismatch" || status.reason === "fallback_backend_unverified") {
    diagnostics = createFallbackActiveDiagnostics(status);
  } else if (status.reason === "refresh_in_progress" || status.state === "indexing") {
    diagnostics = createIndexingDiagnostics(status);
  } else if (status.reason === "repository_stale" || status.state === "stale") {
    diagnostics = createStaleDiagnostics(status);
  } else if (status.reason === "symbol_index_failed" || (status.state === "ready" && status.symbolState && status.symbolState !== "ready" && status.symbolState !== "not_indexed")) {
    diagnostics = createSymbolDiagnostics(status);
  } else if (status.state === "error") {
    diagnostics = createErrorDiagnostics(status);
  } else if (status.configuredBackend && status.backend !== status.configuredBackend) {
    diagnostics = createFallbackActiveDiagnostics(status);
  }

  return diagnostics ? { ...status, diagnostics } : { ...status };
}
