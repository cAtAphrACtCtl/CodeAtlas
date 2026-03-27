import test from "node:test";
import assert from "node:assert/strict";

import { attachIndexStatusDiagnostics } from "../../packages/core/src/diagnostics/index-status-diagnostics.js";

test("attachIndexStatusDiagnostics adds friendly Zoekt remediation when fallback is active", () => {
  const status = attachIndexStatusDiagnostics(
    {
      repo: "sample",
      backend: "ripgrep",
      configuredBackend: "zoekt",
      state: "ready",
      reason: "zoekt_unavailable",
      symbolState: "ready",
      detail: "Zoekt index executable not available: C:/missing/zoekt-index.exe; using bootstrap fallback: fallback ready",
    },
    {
      kind: "zoekt",
      zoektIndexExecutable: "C:/missing/zoekt-index.exe",
      zoektSearchExecutable: "C:/missing/zoekt.exe",
      indexRoot: "C:/tmp/indexes/zoekt",
      allowBootstrapFallback: true,
      bootstrapFallback: {
        kind: "ripgrep",
        executable: "rg",
        fallbackToNaiveScan: true,
      },
    },
  );

  assert.equal(status.diagnostics?.severity, "warning");
  assert.match(status.diagnostics?.summary ?? "", /Zoekt is not available/i);
  assert.match(status.diagnostics?.impact ?? "", /Zoekt-first path|fallback backend|intended/i);
  assert.match((status.diagnostics?.remedies ?? []).join("\n"), /CODEATLAS_CONFIG/);
});

test("attachIndexStatusDiagnostics marks stale repositories with refresh guidance", () => {
  const status = attachIndexStatusDiagnostics(
    {
      repo: "sample",
      backend: "zoekt",
      configuredBackend: "zoekt",
      state: "stale",
      reason: "repository_stale",
      symbolState: "stale",
      detail: "Repository updated on disk",
    },
    {
      kind: "zoekt",
      zoektIndexExecutable: "zoekt-index",
      zoektSearchExecutable: "zoekt",
      indexRoot: "C:/tmp/indexes/zoekt",
      allowBootstrapFallback: true,
      bootstrapFallback: {
        kind: "ripgrep",
        executable: "rg",
        fallbackToNaiveScan: true,
      },
    },
  );

  assert.equal(status.diagnostics?.severity, "warning");
  assert.match(status.diagnostics?.summary ?? "", /stale/i);
  assert.match((status.diagnostics?.remedies ?? []).join("\n"), /refresh_repo/);
});

test("attachIndexStatusDiagnostics explains symbol-only degradation when lexical state is still ready", () => {
  const status = attachIndexStatusDiagnostics(
    {
      repo: "sample",
      backend: "zoekt",
      configuredBackend: "zoekt",
      state: "ready",
      reason: "symbol_index_failed",
      symbolState: "error",
      detail: "symbol indexing failed: parse error",
    },
    {
      kind: "zoekt",
      zoektIndexExecutable: "zoekt-index",
      zoektSearchExecutable: "zoekt",
      indexRoot: "C:/tmp/indexes/zoekt",
      allowBootstrapFallback: true,
      bootstrapFallback: {
        kind: "ripgrep",
        executable: "rg",
        fallbackToNaiveScan: true,
      },
    },
  );

  assert.equal(status.diagnostics?.severity, "warning");
  assert.match(status.diagnostics?.summary ?? "", /symbol indexing/i);
  assert.match(status.diagnostics?.impact ?? "", /find_symbol/i);
});
