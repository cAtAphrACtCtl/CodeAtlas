import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";

import { IndexCoordinator } from "../../packages/core/src/indexer/index-coordinator.js";
import { FileMetadataStore } from "../../packages/core/src/metadata/file-metadata-store.js";
import { createHandlers } from "../../packages/mcp-server/src/mcp/handlers.js";
import { FileSystemSourceReader } from "../../packages/core/src/reader/filesystem-source-reader.js";
import { FileRepositoryRegistry } from "../../packages/core/src/registry/file-repository-registry.js";
import { RipgrepLexicalSearchBackend } from "../../packages/core/src/search/ripgrep-lexical-search-backend.js";
import { SearchService } from "../../packages/core/src/search/search-service.js";

test("MCP handlers expose phase 1 lexical search and source reading", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codeatlas-"));
  const repositoryRoot = path.join(tempRoot, "sample-repo");
  const registryPath = path.join(tempRoot, "registry.json");
  const metadataPath = path.join(tempRoot, "metadata.json");

  await mkdir(path.join(repositoryRoot, "src"), { recursive: true });
  await writeFile(
    path.join(repositoryRoot, "src", "feature.ts"),
    [
      "export function buildAtlas() {",
      "  return 'code atlas';",
      "}",
    ].join("\n"),
    "utf8",
  );

  const registry = new FileRepositoryRegistry(registryPath);
  const metadataStore = new FileMetadataStore(metadataPath);
  const backend = new RipgrepLexicalSearchBackend(
    {
      kind: "ripgrep",
      executable: "rg",
      fallbackToNaiveScan: true,
      contextLines: 2,
    },
    256 * 1024,
  );
  const indexCoordinator = new IndexCoordinator(registry, metadataStore, backend);
  const sourceReader = new FileSystemSourceReader();
  const searchService = new SearchService(registry, indexCoordinator, backend, {
    defaultLimit: 20,
    maxLimit: 100,
    maxBytesPerFile: 256 * 1024,
  });

  await registry.registerRepository({
    name: "sample",
    rootPath: repositoryRoot,
  });

  const handlers = createHandlers({
    registry,
    metadataStore,
    indexCoordinator,
    searchService,
    sourceReader,
  });

  const searchResponse = await handlers.codeSearch({
    query: "code atlas",
    repos: ["sample"],
    limit: 5,
  });

  const searchPayload = searchResponse.structuredContent as {
    source_type: string;
    results: Array<{ repo: string; path: string }>;
  };

  assert.equal(searchPayload.source_type, "lexical");
  assert.equal(searchPayload.results.length, 1);
  assert.equal(searchPayload.results[0]?.repo, "sample");
  assert.equal(searchPayload.results[0]?.path, "src/feature.ts");

  const readResponse = await handlers.readSource({
    repo: "sample",
    path: "src/feature.ts",
    start_line: 1,
    end_line: 2,
  });

  const readPayload = readResponse.structuredContent as { content: string; start_line: number; end_line: number };

  assert.equal(readPayload.start_line, 1);
  assert.equal(readPayload.end_line, 2);
  assert.match(readPayload.content, /buildAtlas/);
});