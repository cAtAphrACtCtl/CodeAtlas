/**
 * Callback sink for IDE integration (VS Code OutputChannel, etc.).
 *
 * Accepts a callback function that receives log events,
 * enabling IDE consumers to display or process events
 * without depending on any specific IDE API.
 */
import type { LogEvent, LogSink } from "./types.js";

export type LogEventCallback = (event: LogEvent) => void;

export class CallbackSink implements LogSink {
	constructor(private readonly callback: LogEventCallback) {}

	write(event: LogEvent): void {
		this.callback(event);
	}
}
