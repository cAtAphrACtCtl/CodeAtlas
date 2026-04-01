/**
 * Request-scoped logging context using AsyncLocalStorage.
 *
 * Created at the MCP handler boundary and propagated through
 * all downstream calls without explicit parameter threading.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import type { RequestLogContext } from "./types.js";

const asyncLocalStorage = new AsyncLocalStorage<RequestLogContext>();

/**
 * Get the current request log context, if any.
 */
export function getRequestContext(): RequestLogContext | undefined {
	return asyncLocalStorage.getStore();
}

/**
 * Run a callback within a request log context.
 * Typically called at the MCP handler wrapper boundary.
 */
export function runWithRequestContext<T>(
	context: Partial<RequestLogContext> & { toolName: string },
	fn: () => T,
): T {
	const full: RequestLogContext = {
		requestId: context.requestId ?? randomUUID(),
		operationId: context.operationId,
		toolName: context.toolName,
	};
	return asyncLocalStorage.run(full, fn);
}
