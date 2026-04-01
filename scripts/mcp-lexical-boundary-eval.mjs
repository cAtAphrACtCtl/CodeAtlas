import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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

async function runSession(configPath, workspaceRoot, repoRoot, repoName, queries) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "./src/mcp-server/main.ts"],
    cwd: workspaceRoot,
    env: { CODEATLAS_CONFIG: configPath },
    stderr: "pipe",
  });

  const client = new Client({ name: `boundary-eval-${repoName}`, version: "0.1.0" });
  await client.connect(transport);

  try {
    const register = await callTool(client, "register_repo", {
      name: repoName,
      root_path: repoRoot,
    });

    const searches = {};
    for (const query of queries) {
      const result = await callTool(client, "code_search", {
        query,
        repos: [repoName],
        limit: 10,
      });
      searches[query] = result.structuredContent.results.map((item) => item.path);
    }

    return {
      register: register.structuredContent.index_status,
      searches,
    };
  } finally {
    await client.close();
  }
}

async function main() {
  const workspaceRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codeatlas-boundary-eval-"));

  try {
    const repoRoot = path.join(tempRoot, "repo");
    await mkdir(path.join(repoRoot, "node_modules", "pkg"), { recursive: true });
    await mkdir(path.join(repoRoot, "dist"), { recursive: true });
    await mkdir(path.join(repoRoot, "data"), { recursive: true });
    await mkdir(path.join(repoRoot, ".next"), { recursive: true });

    await writeFile(path.join(repoRoot, "main.txt"), "root-hit\n", "utf8");
    await writeFile(path.join(repoRoot, ".hidden.txt"), "hidden-hit\n", "utf8");
    await writeFile(path.join(repoRoot, "node_modules", "pkg", "index.js"), "node-hit\n", "utf8");
    await writeFile(path.join(repoRoot, "dist", "output.txt"), "dist-hit\n", "utf8");
    await writeFile(path.join(repoRoot, "data", "cache.txt"), "data-hit\n", "utf8");
    await writeFile(path.join(repoRoot, ".next", "server.txt"), "next-hit\n", "utf8");
    await writeFile(path.join(repoRoot, "big.txt"), `${"x".repeat(270_000)}\nbig-hit\n`, "utf8");
    await writeFile(path.join(repoRoot, "binary.bin"), Buffer.from([0x62, 0x69, 0x6e, 0x2d, 0x68, 0x69, 0x74, 0x00]), "binary");

    const baseConfig = {
      search: {
        defaultLimit: 20,
        maxLimit: 100,
        maxBytesPerFile: 256 * 1024,
      },
      mcp: {
        serverName: "codeatlas-boundary-eval",
        serverVersion: "0.1.0",
      },
    };

    const rgConfigPath = path.join(tempRoot, "ripgrep.json");
    await writeFile(
      rgConfigPath,
      JSON.stringify(
        {
          ...baseConfig,
          registryPath: path.join(tempRoot, "rg-registry.json"),
          metadataPath: path.join(tempRoot, "rg-metadata.json"),
          indexRoot: path.join(tempRoot, "rg-indexes"),
          lexicalBackend: {
            kind: "ripgrep",
            executable: "rg",
            fallbackToNaiveScan: true,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const fallbackConfigPath = path.join(tempRoot, "fallback.json");
    await writeFile(
      fallbackConfigPath,
      JSON.stringify(
        {
          ...baseConfig,
          registryPath: path.join(tempRoot, "fallback-registry.json"),
          metadataPath: path.join(tempRoot, "fallback-metadata.json"),
          indexRoot: path.join(tempRoot, "fallback-indexes"),
          lexicalBackend: {
            kind: "ripgrep",
            executable: "missing-rg-for-eval",
            fallbackToNaiveScan: true,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const queries = ["root-hit", "hidden-hit", "node-hit", "dist-hit", "data-hit", "next-hit", "big-hit", "bin-hit"];
    const ripgrepResult = await runSession(rgConfigPath, workspaceRoot, repoRoot, "rg-repo", queries);
    const fallbackResult = await runSession(fallbackConfigPath, workspaceRoot, repoRoot, "fallback-repo", queries);

    console.log(JSON.stringify({ ripgrepResult, fallbackResult }, null, 2));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

