/**
 * Core logger implementation for CodeAtlas.
 *
 * Provides a structured logging facade that:
 * - Emits LogEvent objects to registered LogSink instances
 * - Automatically enriches events with request context from AsyncLocalStorage
 * - Filters by configured minimum log level
 * - Supports multiple concurrent sinks (file, stderr, callback)
 */
import { getRequestContext } from "./context.js";
import {
	LOG_LEVEL_VALUES,
	type LogEvent,
	type LogLevel,
	type LogSink,
} from "./types.js";

export interface LoggerOptions {
	/** Minimum level to emit. Events below this are dropped. */
	level: LogLevel;
	/** Whether logging is enabled at all. */
	enabled: boolean;
}

/**
 * The main CodeAtlas logger.
 *
 * Usage:
 *   const logger = new Logger({ level: "info", enabled: true });
 *   logger.addSink(myFileSink);
 *   logger.info("mcp", "server started", { transport: "stdio" });
 */
export class Logger {
	private readonly sinks: LogSink[] = [];
	private level: LogLevel;
	private enabled: boolean;

	constructor(options: LoggerOptions) {
		this.level = options.level;
		this.enabled = options.enabled;
	}

	addSink(sink: LogSink): void {
		this.sinks.push(sink);
	}

	setLevel(level: LogLevel): void {
		this.level = level;
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	debug(
		scope: string,
		message: string,
		fields?: Partial<Omit<LogEvent, "timestamp" | "level" | "scope" | "message">>,
	): void {
		this.emit("debug", scope, message, fields);
	}

	info(
		scope: string,
		message: string,
		fields?: Partial<Omit<LogEvent, "timestamp" | "level" | "scope" | "message">>,
	): void {
		this.emit("info", scope, message, fields);
	}

	warn(
		scope: string,
		message: string,
		fields?: Partial<Omit<LogEvent, "timestamp" | "level" | "scope" | "message">>,
	): void {
		this.emit("warn", scope, message, fields);
	}

	error(
		scope: string,
		message: string,
		fields?: Partial<Omit<LogEvent, "timestamp" | "level" | "scope" | "message">>,
	): void {
		this.emit("error", scope, message, fields);
	}

	/**
	 * Flush and close all sinks. Call on process shutdown.
	 */
	close(): void {
		for (const sink of this.sinks) {
			sink.close?.();
		}
	}

	private emit(
		level: LogLevel,
		scope: string,
		message: string,
		fields?: Partial<Omit<LogEvent, "timestamp" | "level" | "scope" | "message">>,
	): void {
		if (!this.enabled) return;
		if (LOG_LEVEL_VALUES[level] < LOG_LEVEL_VALUES[this.level]) return;

		const ctx = getRequestContext();
		const event: LogEvent = {
			timestamp: new Date().toISOString(),
			level,
			scope,
			message,
			requestId: ctx?.requestId,
			operationId: ctx?.operationId,
			toolName: ctx?.toolName,
			...fields,
		};

		for (const sink of this.sinks) {
			sink.write(event);
		}
	}
}

/** Global logger instance, initialized by the runtime bootstrap. */
let globalLogger: Logger | undefined;

/**
 * Set the global logger instance.
 * Called once during service initialization.
 */
export function setGlobalLogger(logger: Logger): void {
	globalLogger = logger;
}

/**
 * Get the global logger instance.
 * Returns undefined if not yet initialized.
 */
export function getLogger(): Logger | undefined {
	return globalLogger;
}
