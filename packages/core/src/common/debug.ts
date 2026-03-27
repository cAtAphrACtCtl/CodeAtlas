import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { DebugConfig, LogLevel } from "../configuration/config.js";

/**
 * Structured logging and debug-tracing module for CodeAtlas.
 *
 * ## Log levels
 *
 * All log calls are filtered by the configured minimum level:
 * - `error`  — always emitted unless level is unset
 * - `warn`   — emitted when level is `warn`, `info`, or `debug`
 * - `info`   — emitted when level is `info` or `debug`
 * - `debug`  — emitted when level is `debug` AND the scope is enabled
 *
 * The minimum level is set via `config.debug.level` (default `"info"`),
 * or via the `CODEATLAS_LOG_LEVEL` environment variable (takes precedence).
 *
 * ## Debug scopes (for `debug`-level messages)
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
 *
 * ## Output
 *
 * Log lines are written to stderr. They are also appended to a file when:
 * - `config.debug.file` is set (config-based, resolved relative to config dir), or
 * - `CODEATLAS_LOG_FILE` environment variable is set (env-based fallback).
 *
 * Additional output sinks can be registered with `addLogSink` for IDE
 * integrations (e.g., a VSCode output channel).
 */

/**
 * A log sink receives every emitted log line after level and scope filtering.
 * Sinks are called synchronously on each `log()` call.
 */
export type LogSink = (level: LogLevel, line: string) => void;

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
};

let configLevel: LogLevel = "info";
let configFlags = new Set<string>();
let configTrace = false;
let configFile: string | undefined;
let ensuredLogDirectory: string | undefined;
let reportedLogWriteFailure = false;
const sinks: LogSink[] = [];

/**
 * Register an additional log sink (e.g., a VSCode output channel).
 * The sink is called for every emitted log line after level and scope filtering.
 * Returns a dispose function that removes the sink.
 */
export function addLogSink(sink: LogSink): () => void {
	sinks.push(sink);
	return () => removeLogSink(sink);
}

/**
 * Remove a previously registered log sink.
 */
export function removeLogSink(sink: LogSink): void {
	const index = sinks.indexOf(sink);
	if (index >= 0) {
		sinks.splice(index, 1);
	}
}

function getEnvFlags(): Set<string> {
	return new Set(
		(process.env.CODEATLAS_DEBUG ?? "")
			.split(",")
			.map((value) => value.trim().toLowerCase())
			.filter(Boolean),
	);
}

function getEffectiveLevel(): LogLevel {
	const envLevel = process.env.CODEATLAS_LOG_LEVEL?.trim().toLowerCase();
	if (
		envLevel === "error" ||
		envLevel === "warn" ||
		envLevel === "info" ||
		envLevel === "debug"
	) {
		return envLevel;
	}

	return configLevel;
}

function getLogFilePath(): string | undefined {
	// Config-based path takes precedence; fall back to env var
	if (configFile) {
		return configFile;
	}

	const value = process.env.CODEATLAS_LOG_FILE?.trim();
	return value ? value : undefined;
}

function ensureLogDirectory(logFilePath: string): void {
	const directory = path.dirname(logFilePath);
	if (ensuredLogDirectory === directory) {
		return;
	}

	mkdirSync(directory, { recursive: true });
	ensuredLogDirectory = directory;
}

function formatLogLine(
	level: LogLevel,
	scope: string,
	message: string,
	details?: Record<string, unknown>,
): string {
	const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}] [codeatlas:${scope}] ${message}`;
	if (!details) {
		return prefix;
	}

	return `${prefix} ${JSON.stringify(details)}`;
}

function mirrorLogLine(level: LogLevel, logLine: string): void {
	const logFilePath = getLogFilePath();
	if (logFilePath) {
		try {
			ensureLogDirectory(logFilePath);
			appendFileSync(logFilePath, `${logLine}\n`, "utf8");
			reportedLogWriteFailure = false;
		} catch (error) {
			if (!reportedLogWriteFailure) {
				reportedLogWriteFailure = true;
				const message = error instanceof Error ? error.message : String(error);
				console.error(
					`[codeatlas:runtime] failed to write log file ${JSON.stringify({ logFilePath, message })}`,
				);
			}
		}
	}

	for (const sink of sinks) {
		try {
			sink(level, logLine);
		} catch {
			// Never let a sink crash the process
		}
	}
}

/**
 * Initialize the logging system from configuration.
 * Call this after loading the config to apply config-based settings.
 * Environment variable settings are always merged and take precedence.
 */
export function initializeDebug(config: DebugConfig): void {
	configLevel = config.level ?? "info";
	configFlags = new Set(
		config.scopes.map((scope) => scope.trim().toLowerCase()).filter(Boolean),
	);
	configTrace = config.trace;
	configFile = config.file;
	// Reset file-write state when re-initializing
	ensuredLogDirectory = undefined;
	reportedLogWriteFailure = false;
}

function isScopeEnabled(scope: string): boolean {
	const normalizedScope = scope.toLowerCase();
	const envFlags = getEnvFlags();
	return (
		envFlags.has("*") ||
		envFlags.has(normalizedScope) ||
		configFlags.has("*") ||
		configFlags.has(normalizedScope)
	);
}

function isLevelEnabled(level: LogLevel): boolean {
	return LOG_LEVEL_ORDER[level] <= LOG_LEVEL_ORDER[getEffectiveLevel()];
}

function tailLines(value: string, count: number): string[] {
	return value.split(/\r?\n/).filter(Boolean).slice(-count);
}

function includeVerboseErrorStreams(): boolean {
	const envFlags = getEnvFlags();
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

/**
 * Emit a structured log message at the given level.
 *
 * - For `error`, `warn`, and `info` levels: the message is emitted whenever
 *   the configured minimum level allows it.
 * - For `debug` level: additionally requires the scope to be enabled via
 *   `CODEATLAS_DEBUG` or `config.debug.scopes`.
 */
export function log(
	level: LogLevel,
	scope: string,
	message: string,
	details?: Record<string, unknown>,
): void {
	if (!isLevelEnabled(level)) {
		return;
	}

	if (level === "debug" && !isScopeEnabled(scope)) {
		return;
	}

	const logLine = formatLogLine(level, scope, message, details);
	console.error(logLine);
	mirrorLogLine(level, logLine);
}

/**
 * Emit a `debug`-level log message for a given scope.
 *
 * This is a convenience wrapper around `log("debug", ...)` that preserves
 * backward compatibility with the original scope-based API.
 */
export function debugLog(
	scope: string,
	message: string,
	details?: Record<string, unknown>,
): void {
	log("debug", scope, message, details);
}
