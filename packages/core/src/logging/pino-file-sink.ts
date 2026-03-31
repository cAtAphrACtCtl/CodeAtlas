/**
 * Pino-based JSONL file sink for CodeAtlas structured logging.
 *
 * Writes log events as JSONL to a file using pino's high-performance
 * transport. Falls back gracefully if the file cannot be opened.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import pino from "pino";

import type { LogEvent, LogLevel, LogSink } from "./types.js";

const PINO_LEVEL_MAP: Record<LogLevel, string> = {
	debug: "debug",
	info: "info",
	warn: "warn",
	error: "error",
};

export class PinoFileSink implements LogSink {
	private readonly pinoLogger: pino.Logger;
	private readonly destination: pino.DestinationStream;
	private reportedFailure = false;

	constructor(filePath: string, level: LogLevel = "debug") {
		const directory = path.dirname(filePath);
		mkdirSync(directory, { recursive: true });

		this.destination = pino.destination({
			dest: filePath,
			sync: false,
			mkdir: true,
		});

		this.pinoLogger = pino(
			{
				level: PINO_LEVEL_MAP[level],
				timestamp: false, // We provide our own ISO timestamp
				// Do not add pid/hostname — keep events lean
				base: undefined,
				// Override pino's default numeric level with our string level name
				formatters: {
					level(label: string) {
						return { level: label };
					},
				},
			},
			this.destination,
		);
	}

	write(event: LogEvent): void {
		try {
			const { level: _level, message, timestamp, ...fields } = event;

			// Remove undefined values to keep JSONL compact
			const cleanFields: Record<string, unknown> = { timestamp };
			for (const [key, value] of Object.entries(fields)) {
				if (value !== undefined) {
					cleanFields[key] = value;
				}
			}

			const pinoLevel = PINO_LEVEL_MAP[event.level];
			const logFn =
				pinoLevel === "error" ? this.pinoLogger.error.bind(this.pinoLogger)
				: pinoLevel === "warn" ? this.pinoLogger.warn.bind(this.pinoLogger)
				: pinoLevel === "debug" ? this.pinoLogger.debug.bind(this.pinoLogger)
				: this.pinoLogger.info.bind(this.pinoLogger);

			logFn(cleanFields, message);
			this.reportedFailure = false;
		} catch (error) {
			if (!this.reportedFailure) {
				this.reportedFailure = true;
				const msg = error instanceof Error ? error.message : String(error);
				console.error(`[codeatlas:logging] file sink write failed: ${msg}`);
			}
		}
	}

	close(): void {
		const dest = this.destination as unknown as { flushSync?: () => void };
		dest.flushSync?.();
	}
}
