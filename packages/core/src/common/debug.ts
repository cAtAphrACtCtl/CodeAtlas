import type { DebugConfig } from "../configuration/config.js";

/**
 * Debug logging module for CodeAtlas.
 *
 * Debug scopes can be enabled via:
 * 1. Configuration file: `debug.scopes` array and `debug.trace` boolean
 * 2. Environment variable: `CODEATLAS_DEBUG=scope1,scope2,trace`
 *
 * Environment variables take precedence and are merged with config settings.
 *
 * Available scopes:
 * - runtime: Configuration loading and service initialization
 * - mcp: MCP handler invocations and responses
 * - indexer: Index coordination and refresh operations
 * - zoekt: Zoekt backend operations
 * - ripgrep: Ripgrep fallback operations
 * - search-service: Search service orchestration
 * - symbol-search: Symbol search operations
 * - symbol-extractor: Symbol extraction from source files
 * - symbol-index: Symbol index storage operations
 * - source-reader: Source file reading operations
 * - registry: Repository registry operations
 * - metadata: Index metadata operations
 * - trace: Include verbose error streams (stderr/stdout tails)
 * - *: Enable all scopes
 */

const envFlags = new Set(
	(process.env.CODEATLAS_DEBUG ?? "")
		.split(",")
		.map((value) => value.trim().toLowerCase())
		.filter(Boolean),
);

let configFlags = new Set<string>();
let configTrace = false;

/**
 * Initialize debug logging from configuration.
 * Call this after loading the config to enable config-based debug settings.
 * Environment variable settings are always merged and take precedence.
 */
export function initializeDebug(config: DebugConfig): void {
	configFlags = new Set(
		config.scopes.map((scope) => scope.trim().toLowerCase()).filter(Boolean),
	);
	configTrace = config.trace;
}

function isEnabled(scope: string): boolean {
	const normalizedScope = scope.toLowerCase();
	return (
		envFlags.has("*") ||
		envFlags.has(normalizedScope) ||
		configFlags.has("*") ||
		configFlags.has(normalizedScope)
	);
}

function tailLines(value: string, count: number): string[] {
	return value.split(/\r?\n/).filter(Boolean).slice(-count);
}

function includeVerboseErrorStreams(): boolean {
	return envFlags.has("trace") || configTrace;
}

export function toErrorDetails(error: unknown): Record<string, unknown> {
	if (error instanceof Error) {
		const candidate = error as Error & {
			code?: string;
			signal?: string;
			stderr?: string;
			stdout?: string;
			cause?: unknown;
		};

		return {
			name: candidate.name,
			message: candidate.message,
			code: candidate.code,
			signal: candidate.signal,
			stderr:
				includeVerboseErrorStreams() && typeof candidate.stderr === "string"
					? tailLines(candidate.stderr, 5)
					: undefined,
			stdout:
				includeVerboseErrorStreams() && typeof candidate.stdout === "string"
					? tailLines(candidate.stdout, 5)
					: undefined,
			cause:
				candidate.cause instanceof Error
					? {
							name: candidate.cause.name,
							message: candidate.cause.message,
						}
					: candidate.cause,
		};
	}

	if (error && typeof error === "object") {
		const candidate = error as {
			message?: unknown;
			code?: unknown;
			signal?: unknown;
			stderr?: unknown;
			stdout?: unknown;
		};

		return {
			message:
				typeof candidate.message === "string"
					? candidate.message
					: String(error),
			code: candidate.code,
			signal: candidate.signal,
			stderr:
				includeVerboseErrorStreams() && typeof candidate.stderr === "string"
					? tailLines(candidate.stderr, 5)
					: undefined,
			stdout:
				includeVerboseErrorStreams() && typeof candidate.stdout === "string"
					? tailLines(candidate.stdout, 5)
					: undefined,
		};
	}

	return {
		message: String(error),
	};
}

export function debugLog(
	scope: string,
	message: string,
	details?: Record<string, unknown>,
): void {
	if (!isEnabled(scope)) {
		return;
	}

	if (details) {
		console.error(`[codeatlas:${scope}] ${message} ${JSON.stringify(details)}`);
		return;
	}

	console.error(`[codeatlas:${scope}] ${message}`);
}
