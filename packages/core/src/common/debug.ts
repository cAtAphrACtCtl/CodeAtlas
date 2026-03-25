const enabledFlags = new Set(
  (process.env.CODEATLAS_DEBUG ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

function isEnabled(scope: string): boolean {
  return enabledFlags.has("*") || enabledFlags.has(scope.toLowerCase());
}

export function debugLog(scope: string, message: string, details?: Record<string, unknown>): void {
  if (!isEnabled(scope)) {
    return;
  }

  if (details) {
    console.error(`[codeatlas:${scope}] ${message} ${JSON.stringify(details)}`);
    return;
  }

  console.error(`[codeatlas:${scope}] ${message}`);
}
