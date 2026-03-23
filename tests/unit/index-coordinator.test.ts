import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { IndexCoordinator } from "../../packages/core/src/indexer/index-coordinator.js";
import type { MetadataStore } from "../../packages/core/src/metadata/metadata-store.js";
import type { RepositoryRegistry } from "../../packages/core/src/registry/repository-registry.js";
import type { LexicalSearchBackend } from "../../packages/core/src/search/lexical-search-backend.js";
import { FileSymbolIndexStore } from "../../packages/core/src/search/symbol-index-store.js";
import { TypeScriptSymbolExtractor } from "../../packages/core/src/search/symbol-extractor.js";

test("IndexCoordinator refreshes repository status independently", async (t) => {
  const tempRepoRoot = await mkdtemp(path.join(os.tmpdir(), "codeatlas-repo-"));
  t.after(async () => {
    await rm(tempRepoRoot, { recursive: true, force: true });
  });
  await mkdir(path.join(tempRepoRoot, "src"), { recursive: true });
  await writeFile(path.join(tempRepoRoot, "src", "repo-a.ts"), "export function repoA() { return true; }\n", "utf8");

  const repository = {
    name: "repo-a",
    rootPath: tempRepoRoot,
    registeredAt: new Date().toISOString(),
  };

  const registry: RepositoryRegistry = {
    async listRepositories() {
      return [repository];
    },
    async getRepository(name) {
      return name === repository.name ? repository : null;
    },
    async registerRepository() {
      return repository;
    },
  };

  const storedStatuses = new Map<string, { repo: string; backend: string; state: "ready" | "not_indexed" | "error"; lastIndexedAt?: string }>();

  const metadataStore: MetadataStore = {
    async listIndexStatuses() {
      return [...storedStatuses.values()];
    },
    async getIndexStatus(repo) {
      return storedStatuses.get(repo) ?? null;
    },
    async setIndexStatus(status) {
      storedStatuses.set(status.repo, status);
    },
  };

  const backend: LexicalSearchBackend = {
    kind: "mock",
    async prepareRepository(candidate) {
      return {
        repo: candidate.name,
        backend: "mock",
        state: "ready",
        lastIndexedAt: "2026-03-19T00:00:00.000Z",
      };
    },
    async searchRepository() {
      return [];
    },
  };

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codeatlas-symbols-"));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });
  const coordinator = new IndexCoordinator(
    registry,
    metadataStore,
    backend,
    new TypeScriptSymbolExtractor(),
    new FileSymbolIndexStore(tempRoot),
  );
  const refreshed = await coordinator.refreshRepository("repo-a");
  const statuses = await coordinator.getStatus();

  assert.equal(refreshed.state, "ready");
  assert.equal(refreshed.symbolState, "ready");
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0]?.repo, "repo-a");
  assert.equal(statuses[0]?.backend, "mock");
});