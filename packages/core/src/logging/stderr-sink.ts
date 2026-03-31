/**
 * Stderr sink for CodeAtlas structured logging.
 *
 * Writes human-readable formatted log lines to stderr,
 * matching the existing debugLog format for familiarity.
 */
import type { LogEvent, LogSink } from "./types.js";

export class StderrSink implements LogSink {
	write(event: LogEvent): void {
		const prefix = `[${event.timestamp}] [codeatlas:${event.scope}] ${event.message}`;

		const contextParts: string[] = [];
		if (event.requestId) contextParts.push(`req=${event.requestId.slice(0, 8)}`);
		if (event.toolName) contextParts.push(`tool=${event.toolName}`);
		if (event.durationMs !== undefined) contextParts.push(`duration=${event.durationMs}ms`);

		// Collect non-standard fields into details for display
		const displayDetails: Record<string, unknown> = {};
		if (event.repo) displayDetails.repo = event.repo;
		if (event.backend) displayDetails.backend = event.backend;
		if (event.details) Object.assign(displayDetails, event.details);
		if (event.error) displayDetails.error = event.error;

		const contextStr = contextParts.length > 0 ? ` (${contextParts.join(", ")})` : "";
		const detailsStr = Object.keys(displayDetails).length > 0
			? ` ${JSON.stringify(displayDetails)}`
			: "";

		console.error(`${prefix}${contextStr}${detailsStr}`);
	}
}
