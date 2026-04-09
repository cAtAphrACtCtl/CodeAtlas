import path from "node:path";

import type {
	LexicalBackendConfig,
	RipgrepLexicalBackendConfig,
	ZoektLexicalBackendConfig,
} from "../configuration/config.js";
import {
	deriveServiceTier as computeServiceTier,
	type RepositoryIndexStatus,
} from "../metadata/metadata-store.js";

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
	return (
		path.isAbsolute(value) ||
		value.startsWith(".") ||
		value.includes("/") ||
		value.includes("\\")
	);
}

function summarizeRuntimeHint(config: LexicalBackendConfig): string[] {
	if (config.kind !== "zoekt") {
		return [];
	}

	const indexExecutable = config.zoektIndexExecutable;
	const searchExecutable = config.zoektSearchExecutable;
	const windowsExecutables =
		indexExecutable.toLowerCase().endsWith(".exe") ||
		searchExecutable.toLowerCase().endsWith(".exe");

	if (process.platform === "win32") {
		return windowsExecutables
			? []
			: [
					"The current process is running on Windows, but the configured Zoekt executables do not look like Windows binaries.",
				];
	}

	return windowsExecutables
		? [
				"The current process is not running on Windows, but the configured Zoekt executables look like Windows binaries.",
			]
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

function createFallbackActiveDiagnostics(
	status: RepositoryIndexStatus,
): RepositoryIndexDiagnostics {
	const activeBackend = status.activeBackend ?? status.backend;
	return {
		severity: "warning",
		summary: `Configured lexical backend is ${status.configuredBackend}, but the active backend for this repository is ${activeBackend}.`,
		impact:
			"CodeAtlas is running in a degraded retrieval mode for this repository. Results may still be available, but they are not coming from the intended backend.",
		causes: [
			status.fallbackReason ??
			status.detail ??
				"The active backend reported a fallback condition.",
		],
		remedies: [
			"Inspect the backend detail message and restore the configured backend before treating the environment as production-ready.",
			"Run `get_index_status` again after the fix to verify that `backend` matches `configuredBackend`.",
		],
	};
}

function createIndexingDiagnostics(
	status: RepositoryIndexStatus,
): RepositoryIndexDiagnostics {
	const activeBackend = status.activeBackend ?? status.backend;
	const fallbackLine =
		status.fallbackActive && activeBackend
			? ` Lexical search remains available via ${activeBackend} while refresh is running.`
			: "";
	return {
		severity: "info",
		summary: status.fallbackActive
			? `Repository refresh is in progress, and ${activeBackend} is currently serving lexical search.`
			: "Repository refresh is in progress.",
		impact:
			`Lexical and symbol data may still reflect the last completed refresh until the current refresh finishes.${fallbackLine}`,
		causes: [status.detail ?? "Repository refresh in progress"],
		remedies: [
			"Wait for the current refresh to complete, then call `get_index_status` again.",
		],
	};
}

function createStaleDiagnostics(
	status: RepositoryIndexStatus,
): RepositoryIndexDiagnostics {
	return {
		severity: "warning",
		summary:
			"Repository index is stale and should be refreshed before relying on results.",
		impact:
			"Search results may miss recent file changes until the repository is refreshed.",
		causes: [
			status.detail ?? "Repository contents changed and require refresh",
		],
		remedies: [
			"Run `refresh_repo` for this repository.",
			"If this keeps recurring unexpectedly, inspect file update handling in the current runtime.",
		],
	};
}

function createSymbolDiagnostics(
	status: RepositoryIndexStatus,
): RepositoryIndexDiagnostics {
	return {
		severity: status.state === "ready" ? "warning" : "error",
		summary: "Lexical indexing succeeded, but background symbol extraction is not ready.",
		impact:
			status.state === "ready"
				? "`code_search` and lexical-backed `find_symbol` can still work, but symbol metrics and any snapshot-derived symbol artifacts may be stale."
				: "Both lexical and symbol workflows may be affected until refresh succeeds.",
		causes: [status.detail ?? `Symbol state is ${status.symbolState}.`],
		remedies: [
			"Run `refresh_repo` again after fixing the symbol extraction issue.",
			"If `find_symbol` results look noisy, use `read_source` to verify the matched lines while background symbol extraction is unavailable.",
		],
	};
}

function createErrorDiagnostics(
	status: RepositoryIndexStatus,
): RepositoryIndexDiagnostics {
	return {
		severity: "error",
		summary: "Repository index is in an error state.",
		impact:
			"The current repository cannot be treated as ready for normal retrieval until the error is fixed.",
		causes: [status.detail ?? "Unknown indexing error"],
		remedies: [
			"Fix the reported environment or repository issue.",
			"Re-run `refresh_repo` after the fix to verify recovery.",
		],
	};
}

export function attachIndexStatusDiagnostics(
	status: RepositoryIndexStatus,
	lexicalBackendConfig: LexicalBackendConfig,
): DiagnosedRepositoryIndexStatus {
	const statusWithServiceTier: DiagnosedRepositoryIndexStatus = {
		...status,
		serviceTier: status.serviceTier ?? computeServiceTier(status),
	};
	let diagnostics: RepositoryIndexDiagnostics | undefined;

	if (
		statusWithServiceTier.reason === "zoekt_unavailable" &&
		lexicalBackendConfig.kind === "zoekt"
	) {
		diagnostics = createZoektUnavailableDiagnostics(
			statusWithServiceTier,
			lexicalBackendConfig,
		);
	} else if (
		(statusWithServiceTier.reason === "ripgrep_unavailable" ||
			statusWithServiceTier.reason === "ripgrep_naive_fallback") &&
		lexicalBackendConfig.kind === "ripgrep"
	) {
		diagnostics = createRipgrepUnavailableDiagnostics(
			statusWithServiceTier,
			lexicalBackendConfig,
		);
	} else if (
		statusWithServiceTier.reason === "refresh_in_progress" ||
		statusWithServiceTier.state === "indexing"
	) {
		diagnostics = createIndexingDiagnostics(statusWithServiceTier);
	} else if (
		statusWithServiceTier.reason === "configured_backend_mismatch" ||
		statusWithServiceTier.reason === "fallback_backend_unverified" ||
		statusWithServiceTier.fallbackActive
	) {
		diagnostics = createFallbackActiveDiagnostics(statusWithServiceTier);
	} else if (
		statusWithServiceTier.reason === "repository_stale" ||
		statusWithServiceTier.state === "stale"
	) {
		diagnostics = createStaleDiagnostics(statusWithServiceTier);
	} else if (
		statusWithServiceTier.reason === "symbol_index_failed" ||
		(statusWithServiceTier.state === "ready" &&
			statusWithServiceTier.symbolState &&
			statusWithServiceTier.symbolState !== "ready" &&
			statusWithServiceTier.symbolState !== "not_indexed")
	) {
		diagnostics = createSymbolDiagnostics(statusWithServiceTier);
	} else if (statusWithServiceTier.state === "error") {
		diagnostics = createErrorDiagnostics(statusWithServiceTier);
	} else if (
		statusWithServiceTier.configuredBackend &&
		statusWithServiceTier.backend !== statusWithServiceTier.configuredBackend
	) {
		diagnostics = createFallbackActiveDiagnostics(statusWithServiceTier);
	}

	return diagnostics
		? { ...statusWithServiceTier, diagnostics }
		: statusWithServiceTier;
}
