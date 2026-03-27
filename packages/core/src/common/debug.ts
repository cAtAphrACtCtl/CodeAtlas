const enabledFlags = new Set(
	(process.env.CODEATLAS_DEBUG ?? "")
		.split(",")
		.map((value) => value.trim().toLowerCase())
		.filter(Boolean),
);

function isEnabled(scope: string): boolean {
	return enabledFlags.has("*") || enabledFlags.has(scope.toLowerCase());
}

function tailLines(value: string, count: number): string[] {
	return value.split(/\r?\n/).filter(Boolean).slice(-count);
}

function includeVerboseErrorStreams(): boolean {
	return isEnabled("trace");
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
