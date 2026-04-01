/**
 * Logging type definitions for CodeAtlas.
 *
 * These types define the structured log event model, log levels,
 * sink interface, and request context used across the platform.
 */

/** Supported log levels in ascending severity order. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Numeric weight for log levels (lower = more verbose). */
export const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

/**
 * Per-request context propagated via AsyncLocalStorage.
 * Created at the MCP handler boundary and available in all downstream calls.
 */
export interface RequestLogContext {
	/** Unique identifier for the MCP request. */
	requestId: string;
	/** Optional operation identifier for long-running flows (e.g. refresh). */
	operationId?: string;
	/** MCP tool name being invoked. */
	toolName?: string;
}

/**
 * A structured log event.
 *
 * Event names follow `domain.action.result` convention, e.g.
 * `mcp.request.start`, `index.refresh.complete`, `search.lexical.complete`.
 */
export interface LogEvent {
	/** ISO-8601 timestamp. */
	timestamp: string;
	/** Severity level. */
	level: LogLevel;
	/** Hierarchical scope, e.g. "mcp", "indexer", "search-service". */
	scope: string;
	/** Structured event name in domain.action.result style. */
	event?: string;
	/** Human-readable message. */
	message: string;

	// --- Request context (populated from AsyncLocalStorage) ---
	requestId?: string;
	operationId?: string;
	toolName?: string;

	// --- Operational fields ---
	repo?: string;
	backend?: string;
	configuredBackend?: string;
	durationMs?: number;
	statusReason?: string;
	clientKind?: string;
	ideKind?: string;

	// --- Error fields ---
	error?: Record<string, unknown>;

	// --- Catch-all for domain-specific details ---
	details?: Record<string, unknown>;
}

/**
 * A destination for log events.
 *
 * Sinks are registered with the logger and receive all events
 * at or above the configured minimum level.
 */
export interface LogSink {
	/** Write a log event to this sink. */
	write(event: LogEvent): void;
	/** Flush and release resources. */
	close?(): void;
}

/**
 * Logging configuration block.
 *
 * Lives at the top level of CodeAtlasConfig under the `logging` key.
 */
export interface LoggingConfig {
	/** Master switch. Defaults to true. */
	enabled: boolean;
	/** Minimum log level. Defaults to "info". */
	level: LogLevel;
	/** Output format for file sink. Only "jsonl" is supported in the current version. */
	format: "jsonl";
	/** File output configuration. */
	file: {
		/** Whether file logging is enabled. Defaults to true. */
		enabled: boolean;
		/** File path for log output. Defaults to "data/debug/codeatlas.log.jsonl". */
		path: string;
	};
	/** Whether to include verbose error stream tails (stderr/stdout). */
	includeErrorStreamTails: boolean;
}
