import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

async function callTool(client, name, args) {
  return client.request(
    {
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
    },
    CallToolResultSchema,
  );
}

function getToolText(result) {
  return (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function assertToolSuccess(result, name) {
  assert.notEqual(result.isError, true, `Expected tool ${name} to succeed${getToolText(result) ? `: ${getToolText(result)}` : ""}`);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolvePreferredLexicalBackend(workspaceRoot) {
  const windowsInstalledIndex = path.join(workspaceRoot, ".tools", "zoekt", "bin", "zoekt-index.exe");
  const windowsInstalledSearch = path.join(workspaceRoot, ".tools", "zoekt", "bin", "zoekt.exe");
  if ((await exists(windowsInstalledIndex)) && (await exists(windowsInstalledSearch))) {
    return {
      expectedBackend: "zoekt",
      config: {
        kind: "zoekt",
        zoektIndexExecutable: windowsInstalledIndex,
        zoektSearchExecutable: windowsInstalledSearch,
        allowBootstrapFallback: true,
        bootstrapFallback: {
          kind: "ripgrep",
          executable: "rg",
          fallbackToNaiveScan: true,
        },
      },
    };
  }

  const windowsSourceIndex = path.join(workspaceRoot, ".tools", "zoekt", "source-win-bin", "zoekt-index.exe");
  const windowsSourceSearch = path.join(workspaceRoot, ".tools", "zoekt", "source-win-bin", "zoekt.exe");
  if ((await exists(windowsSourceIndex)) && (await exists(windowsSourceSearch))) {
    return {
      expectedBackend: "zoekt",
      config: {
        kind: "zoekt",
        zoektIndexExecutable: windowsSourceIndex,
        zoektSearchExecutable: windowsSourceSearch,
        allowBootstrapFallback: true,
        bootstrapFallback: {
          kind: "ripgrep",
          executable: "rg",
          fallbackToNaiveScan: true,
        },
      },
    };
  }

  const linuxInstalledIndex = path.join(workspaceRoot, ".tools", "zoekt", "bin", "zoekt-index");
  const linuxInstalledSearch = path.join(workspaceRoot, ".tools", "zoekt", "bin", "zoekt");
  if (process.platform !== "win32" && (await exists(linuxInstalledIndex)) && (await exists(linuxInstalledSearch))) {
    return {
      expectedBackend: "zoekt",
      config: {
        kind: "zoekt",
        zoektIndexExecutable: linuxInstalledIndex,
        zoektSearchExecutable: linuxInstalledSearch,
        allowBootstrapFallback: true,
        bootstrapFallback: {
          kind: "ripgrep",
          executable: "rg",
          fallbackToNaiveScan: true,
        },
      },
    };
  }

  const linuxZoektIndex = path.join(workspaceRoot, ".tools", "zoekt", "linux-bin", "zoekt-index");
  const linuxZoektSearch = path.join(workspaceRoot, ".tools", "zoekt", "linux-bin", "zoekt");
  if (process.platform !== "win32" && (await exists(linuxZoektIndex)) && (await exists(linuxZoektSearch))) {
    return {
      expectedBackend: "zoekt",
      config: {
        kind: "zoekt",
        zoektIndexExecutable: linuxZoektIndex,
        zoektSearchExecutable: linuxZoektSearch,
        allowBootstrapFallback: true,
        bootstrapFallback: {
          kind: "ripgrep",
          executable: "rg",
          fallbackToNaiveScan: true,
        },
      },
    };
  }

  return {
    expectedBackend: "ripgrep",
    config: {
      kind: "ripgrep",
      executable: "rg",
      fallbackToNaiveScan: true,
    },
  };
}

function sanitizeRepoName(value) {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "repo";
}

function roundMs(value) {
  return Number(value.toFixed(1));
}

async function measure(operation) {
  const startedAt = performance.now();
  const result = await operation();
  return {
    result,
    elapsedMs: roundMs(performance.now() - startedAt),
  };
}

function parseArgs(argv) {
  const options = {
    repoRoot: null,
    repoName: null,
    queries: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--repo-root") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --repo-root");
      }
      options.repoRoot = value;
      index += 1;
      continue;
    }

    if (argument === "--repo-name") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --repo-name");
      }
      options.repoName = value;
      index += 1;
      continue;
    }

    if (argument === "--query") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --query");
      }
      options.queries.push(value);
      index += 1;
      continue;
    }

    if (argument === "--help") {
      console.log(`Usage: npm run mcp:refresh-eval -- [--repo-root <path>] [--repo-name <name>] [--query <text>]...\n\nDefaults:\n- repo root: current workspace\n- repo name: eval-<repo-folder-name>\n- queries: export, class, function`);
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function getBackendSummary(indexStatus) {
  return {
    active: indexStatus.backend,
    configured: indexStatus.configuredBackend ?? indexStatus.backend,
    state: indexStatus.state,
    reason: indexStatus.reason ?? null,
    detail: indexStatus.detail ?? null,
  };
}

function getValidationMode(indexStatus) {
  const configured = indexStatus.configuredBackend ?? indexStatus.backend;
  if (configured === "zoekt" && indexStatus.backend === "zoekt") {
    return "zoekt-indexed";
  }

  if (configured === "zoekt") {
    return "zoekt-fallback";
  }

  return "live-search";
}

async function measureQuery(client, repoName, query) {
  const search = await measure(() =>
    callTool(client, "code_search", {
      query,
      repos: [repoName],
      limit: 10,
    }),
  );
  assertToolSuccess(search.result, "code_search");
  const payload = search.result.structuredContent;
  assert.equal(payload.source_type, "lexical");

  return {
    query,
    elapsedMs: search.elapsedMs,
    resultCount: payload.results.length,
    topPath: payload.results[0]?.path ?? null,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const workspaceRoot = process.cwd();
  const targetRepoRoot = path.resolve(options.repoRoot ?? workspaceRoot);
  const targetRepoName = options.repoName ?? `eval-${sanitizeRepoName(path.basename(targetRepoRoot))}`;
  const queries = options.queries.length > 0 ? options.queries : ["export", "class", "function"];

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codeatlas-refresh-eval-"));
  const configPath = path.join(tempRoot, "codeatlas.json");
  const registryPath = path.join(tempRoot, "repositories.local.json");
  const metadataPath = path.join(tempRoot, "index-status.local.json");
  const indexRoot = path.join(tempRoot, "indexes");
  const lexicalBackend = await resolvePreferredLexicalBackend(workspaceRoot);

  try {
    await writeFile(
      configPath,
      JSON.stringify(
        {
          registryPath,
          metadataPath,
          indexRoot,
          lexicalBackend: lexicalBackend.config,
          search: {
            defaultLimit: 20,
            maxLimit: 100,
            maxBytesPerFile: 262144,
          },
          mcp: {
            serverName: "codeatlas-refresh-eval",
            serverVersion: "0.1.0",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "./packages/mcp-server/src/main.ts"],
      cwd: workspaceRoot,
      env: {
        CODEATLAS_CONFIG: configPath,
        ...(process.env.CODEATLAS_DEBUG ? { CODEATLAS_DEBUG: process.env.CODEATLAS_DEBUG } : {}),
      },
      stderr: "pipe",
    });

    const stderrChunks = [];
    transport.stderr?.on("data", (chunk) => {
      stderrChunks.push(chunk.toString());
    });

    const client = new Client({ name: "codeatlas-refresh-eval-client", version: "0.1.0" });
    await client.connect(transport);

    try {
      const initialRegister = await measure(() =>
        callTool(client, "register_repo", {
          name: targetRepoName,
          root_path: targetRepoRoot,
        }),
      );
      assertToolSuccess(initialRegister.result, "register_repo");
      const initialRegisterPayload = initialRegister.result.structuredContent;
      assert.equal(initialRegisterPayload.repository.name, targetRepoName);
      assert.equal(initialRegisterPayload.index_status.state, "ready");

      const repeatedRefresh = await measure(() =>
        callTool(client, "refresh_repo", {
          repo: targetRepoName,
        }),
      );
      assertToolSuccess(repeatedRefresh.result, "refresh_repo");
      const repeatedRefreshPayload = repeatedRefresh.result.structuredContent;
      assert.equal(repeatedRefreshPayload.index_status.state, "ready");

      const queryMetrics = [];
      for (const query of queries) {
        queryMetrics.push(await measureQuery(client, targetRepoName, query));
      }

      const syntheticRepoName = "refresh-eval-synthetic";
      const syntheticRepoRoot = path.join(tempRoot, syntheticRepoName);
      const syntheticFilePath = path.join(syntheticRepoRoot, "src", "probe.ts");
      const tokenSeed = Date.now().toString(36);
      const beforeToken = `codeatlas_refresh_before_${tokenSeed}`;
      const afterToken = `codeatlas_refresh_after_${tokenSeed}`;

      await mkdir(path.dirname(syntheticFilePath), { recursive: true });
      await writeFile(syntheticFilePath, `export const refreshProbe = "${beforeToken}";\n`, "utf8");

      const syntheticRegister = await measure(() =>
        callTool(client, "register_repo", {
          name: syntheticRepoName,
          root_path: syntheticRepoRoot,
        }),
      );
      assertToolSuccess(syntheticRegister.result, "register_repo");
      const syntheticRegisterPayload = syntheticRegister.result.structuredContent;
      assert.equal(syntheticRegisterPayload.index_status.state, "ready");

      const initialSyntheticSearch = await measureQuery(client, syntheticRepoName, beforeToken);
      assert.ok(initialSyntheticSearch.resultCount > 0, "Expected synthetic repository to return the original token before mutation");

      await writeFile(syntheticFilePath, `export const refreshProbe = "${afterToken}";\n`, "utf8");

      const staleOldToken = await measureQuery(client, syntheticRepoName, beforeToken);
      const staleNewToken = await measureQuery(client, syntheticRepoName, afterToken);

      const syntheticRefresh = await measure(() =>
        callTool(client, "refresh_repo", {
          repo: syntheticRepoName,
        }),
      );
      assertToolSuccess(syntheticRefresh.result, "refresh_repo");
      const syntheticRefreshPayload = syntheticRefresh.result.structuredContent;
      assert.equal(syntheticRefreshPayload.index_status.state, "ready");

      const refreshedOldToken = await measureQuery(client, syntheticRepoName, beforeToken);
      const refreshedNewToken = await measureQuery(client, syntheticRepoName, afterToken);

      const validationMode = getValidationMode(syntheticRegisterPayload.index_status);
      if (validationMode === "zoekt-indexed") {
        assert.ok(staleOldToken.resultCount > 0, "Expected the old token to remain visible until refresh when Zoekt is active");
        assert.equal(staleNewToken.resultCount, 0, "Expected the new token to remain hidden until refresh when Zoekt is active");
      }

      if (validationMode === "live-search") {
        assert.equal(staleOldToken.resultCount, 0, "Expected the old token to disappear immediately when live lexical search is active");
        assert.ok(staleNewToken.resultCount > 0, "Expected the new token to appear immediately when live lexical search is active");
      }

      assert.equal(refreshedOldToken.resultCount, 0, "Expected the old token to be absent after refresh");
      assert.ok(refreshedNewToken.resultCount > 0, "Expected the new token to appear after refresh");

      const summary = {
        targetRepo: {
          name: targetRepoName,
          rootPath: targetRepoRoot,
          backend: getBackendSummary(initialRegisterPayload.index_status),
          initialIndexMs: initialRegister.elapsedMs,
          repeatedRefreshMs: repeatedRefresh.elapsedMs,
          queries: queryMetrics,
        },
        refreshUpdateValidation: {
          repo: syntheticRepoName,
          mode: validationMode,
          backend: getBackendSummary(syntheticRegisterPayload.index_status),
          initialIndexMs: syntheticRegister.elapsedMs,
          repeatedRefreshMs: syntheticRefresh.elapsedMs,
          beforeMutation: {
            originalTokenCount: initialSyntheticSearch.resultCount,
          },
          afterMutationBeforeRefresh: {
            oldTokenCount: staleOldToken.resultCount,
            newTokenCount: staleNewToken.resultCount,
          },
          afterRefresh: {
            oldTokenCount: refreshedOldToken.resultCount,
            newTokenCount: refreshedNewToken.resultCount,
          },
          note:
            validationMode === "zoekt-indexed"
              ? "Zoekt was active for the synthetic repo, so this run proves refresh-after-update behavior for the indexed path."
              : validationMode === "zoekt-fallback"
                ? "Configured backend was Zoekt, but this run used a fallback backend. The timing data is still useful, but it does not fully prove Zoekt refresh semantics."
                : "This run used the live ripgrep path, so query timings are valid for fallback mode but not for indexed Zoekt semantics.",
        },
        stderr: stderrChunks.join("") || null,
      };

      console.log(JSON.stringify(summary, null, 2));
    } finally {
      await client.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("Refresh evaluation failed.");
  console.error(error);
  process.exit(1);
});
