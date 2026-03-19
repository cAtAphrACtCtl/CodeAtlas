import test from "node:test";
import assert from "node:assert/strict";

import { IndexCoordinator } from "../../packages/core/src/indexer/index-coordinator.js";
import type { MetadataStore } from "../../packages/core/src/metadata/metadata-store.js";
import type { RepositoryRegistry } from "../../packages/core/src/registry/repository-registry.js";
import type { LexicalSearchBackend } from "../../packages/core/src/search/lexical-search-backend.js";

test("IndexCoordinator refreshes repository status independently", async () => {
  const repository = {
    name: "repo-a",
    rootPath: "C:/repos/repo-a",
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

  const coordinator = new IndexCoordinator(registry, metadataStore, backend);
  const refreshed = await coordinator.refreshRepository("repo-a");
  const statuses = await coordinator.getStatus();

  assert.equal(refreshed.state, "ready");
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0]?.repo, "repo-a");
  assert.equal(statuses[0]?.backend, "mock");
});