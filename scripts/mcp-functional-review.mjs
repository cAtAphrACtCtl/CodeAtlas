import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

async function expectToolFailure(client, name, args, pattern) {
  const result = await callTool(client, name, args);
  assert.equal(result.isError, true, `Expected tool ${name} to return isError=true`);

  const textContent = result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");

  assert.match(textContent, pattern);
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
  const windowsZoektIndex = path.join(workspaceRoot, ".tools", "zoekt", "source-win-bin", "zoekt-index.exe");
  const windowsZoektSearch = path.join(workspaceRoot, ".tools", "zoekt", "source-win-bin", "zoekt.exe");
  if ((await exists(windowsZoektIndex)) && (await exists(windowsZoektSearch))) {
    return {
      expectedBackend: "zoekt",
      config: {
        kind: "zoekt",
        zoektIndexExecutable: windowsZoektIndex,
        zoektSearchExecutable: windowsZoektSearch,
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

async function main() {
  const workspaceRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codeatlas-functional-review-"));
  const configPath = path.join(tempRoot, "codeatlas.json");
  const registryPath = path.join(tempRoot, "repositories.local.json");
  const metadataPath = path.join(tempRoot, "index-status.local.json");
  const indexRoot = path.join(tempRoot, "indexes");
  const logPath = path.join(tempRoot, "codeatlas-functional-review.log.jsonl");
  const logLevel = process.env.CODEATLAS_LOG_LEVEL ?? "info";
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
            serverName: "codeatlas-functional-review",
            serverVersion: "0.1.0",
          },
          logging: {
            enabled: true,
            level: logLevel,
            format: "jsonl",
            file: {
              enabled: true,
              path: logPath,
            },
            includeErrorStreamTails: true,
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
      },
      stderr: "pipe",
    });

    const stderrChunks = [];
    transport.stderr?.on("data", (chunk) => {
      stderrChunks.push(chunk.toString());
    });

    const client = new Client({ name: "codeatlas-functional-review-client", version: "0.1.0" });
    await client.connect(transport);

    try {
      const tools = await client.listTools();
      const toolNames = new Set(tools.tools.map((tool) => tool.name));
      for (const requiredTool of [
        "list_repos",
        "register_repo",
        "code_search",
        "find_symbol",
        "semantic_search",
        "hybrid_search",
        "read_source",
        "get_index_status",
        "refresh_repo",
      ]) {
        assert.equal(toolNames.has(requiredTool), true, `Expected MCP tool ${requiredTool} to be registered`);
      }
      console.log("PASS MCP server exposes the expected stable tool set");

      const listBefore = await callTool(client, "list_repos", {});
      const listBeforePayload = listBefore.structuredContent;
      assert.deepEqual(listBeforePayload.repositories, []);
      assert.deepEqual(listBeforePayload.index_status, []);
      console.log("PASS list_repos returns empty state before registration");

      const registerResult = await callTool(client, "register_repo", {
        name: "codeatlas-current",
        root_path: workspaceRoot,
      });
      const registerPayload = registerResult.structuredContent;
      assert.equal(registerPayload.repository.name, "codeatlas-current");
      assert.equal(registerPayload.index_status.state, "ready");
      assert.equal(registerPayload.index_status.symbolState, "ready");
      assert.equal(registerPayload.index_status.configuredBackend ?? registerPayload.index_status.backend, lexicalBackend.expectedBackend);
      if (lexicalBackend.expectedBackend === "zoekt") {
        assert.equal(
          registerPayload.index_status.backend,
          "zoekt",
          `Expected Zoekt to be used during registration, but backend was ${registerPayload.index_status.backend}. Detail: ${registerPayload.index_status.detail ?? "none"}`,
        );
      }
      console.log("PASS register_repo indexes current repository successfully");

      await expectToolFailure(
        client,
        "register_repo",
        {
          name: "codeatlas-current",
          root_path: workspaceRoot,
        },
        /Repository already registered/,
      );
      console.log("PASS duplicate register_repo fails clearly");

      const statusResult = await callTool(client, "get_index_status", {
        repo: "codeatlas-current",
      });
      const statusPayload = statusResult.structuredContent;
      assert.equal(statusPayload.index_status.length, 1);
      assert.equal(statusPayload.index_status[0].state, "ready");
      assert.equal(statusPayload.index_status[0].configuredBackend ?? statusPayload.index_status[0].backend, lexicalBackend.expectedBackend);
      if (lexicalBackend.expectedBackend === "zoekt") {
        assert.equal(
          statusPayload.index_status[0].backend,
          "zoekt",
          `Expected Zoekt to remain active in get_index_status, but backend was ${statusPayload.index_status[0].backend}. Detail: ${statusPayload.index_status[0].detail ?? "none"}`,
        );
      }
      console.log("PASS get_index_status reports ready state");

      const searchResult = await callTool(client, "code_search", {
        query: "createCodeAtlasServices",
        repos: ["codeatlas-current"],
        limit: 5,
      });
      const searchPayload = searchResult.structuredContent;
      assert.equal(searchPayload.source_type, "lexical");
      assert.ok(searchPayload.results.length > 0);
      console.log("PASS code_search returns lexical matches");

      const semanticResult = await callTool(client, "semantic_search", {
        query: "createCodeAtlasServices",
        repos: ["codeatlas-current"],
        limit: 5,
      });
      const semanticPayload = semanticResult.structuredContent;
      assert.equal(semanticPayload.not_implemented, true);
      assert.equal(semanticPayload.source_type, "semantic");
      console.log("PASS semantic_search preserves placeholder contract");

      const hybridResult = await callTool(client, "hybrid_search", {
        query: "createCodeAtlasServices",
        repos: ["codeatlas-current"],
        limit: 5,
      });
      const hybridPayload = hybridResult.structuredContent;
      assert.equal(hybridPayload.not_implemented, true);
      assert.equal(hybridPayload.source_type, "hybrid");
      console.log("PASS hybrid_search preserves placeholder contract");

      const symbolResult = await callTool(client, "find_symbol", {
        query: "createCodeAtlasServices",
        repos: ["codeatlas-current"],
        exact: true,
        limit: 5,
      });
      const symbolPayload = symbolResult.structuredContent;
      assert.equal(symbolPayload.results.length, 1);
      assert.equal(symbolPayload.results[0].name, "createCodeAtlasServices");
      console.log("PASS find_symbol exact=true returns only exact symbol matches");

      const readResult = await callTool(client, "read_source", {
        repo: "codeatlas-current",
        path: "packages/core/src/runtime.ts",
        start_line: 35,
        end_line: 50,
      });
      const readPayload = readResult.structuredContent;
      assert.match(readPayload.content, /createCodeAtlasServices/);
      console.log("PASS read_source returns requested source range");

      await expectToolFailure(
        client,
        "read_source",
        {
          repo: "codeatlas-current",
          path: "packages/core/src/runtime.ts",
          start_line: 99999,
          end_line: 100000,
        },
        /start_line exceeds file length/,
      );
      console.log("PASS read_source rejects out-of-range start_line");

      await expectToolFailure(
        client,
        "read_source",
        {
          repo: "codeatlas-current",
          path: "../package.json",
          start_line: 1,
          end_line: 5,
        },
        /escapes repository root/,
      );
      console.log("PASS read_source rejects repository escape paths");

      await expectToolFailure(
        client,
        "code_search",
        {
          query: "createCodeAtlasServices",
          repos: ["unknown-repo"],
          limit: 5,
        },
        /Unknown repositories/,
      );
      console.log("PASS code_search rejects unknown repositories");

      const refreshResult = await callTool(client, "refresh_repo", {
        repo: "codeatlas-current",
      });
      const refreshPayload = refreshResult.structuredContent;
      assert.equal(refreshPayload.index_status.state, "ready");
      assert.equal(refreshPayload.index_status.configuredBackend ?? refreshPayload.index_status.backend, lexicalBackend.expectedBackend);
      if (lexicalBackend.expectedBackend === "zoekt") {
        assert.equal(
          refreshPayload.index_status.backend,
          "zoekt",
          `Expected Zoekt to be used during refresh, but backend was ${refreshPayload.index_status.backend}. Detail: ${refreshPayload.index_status.detail ?? "none"}`,
        );
      }
      console.log("PASS refresh_repo refreshes current repository successfully");
    } finally {
      await client.close();
    }

    const registryText = await readFile(registryPath, "utf8");
    const metadataText = await readFile(metadataPath, "utf8");

    console.log("REGISTRY_FILE", registryText);
    console.log("METADATA_FILE", metadataText);
    console.log("LOG_LEVEL", logLevel);
    console.log("LOG_FILE", logPath);
    console.log("LEXICAL_BACKEND", lexicalBackend.expectedBackend);
    console.log("STDERR", stderrChunks.join(""));
    console.log("Functional review completed successfully.");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("Functional review failed.");
  console.error(error);
  process.exit(1);
});
