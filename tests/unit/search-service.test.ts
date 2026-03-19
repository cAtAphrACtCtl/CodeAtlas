import test from "node:test";
import assert from "node:assert/strict";

import type { IndexCoordinator } from "../../packages/core/src/indexer/index-coordinator.js";
import type { RepositoryRegistry } from "../../packages/core/src/registry/repository-registry.js";
import type { LexicalSearchBackend } from "../../packages/core/src/search/lexical-search-backend.js";
import { SearchService } from "../../packages/core/src/search/search-service.js";

test("SearchService returns lexical results using the stable result contract", async () => {
  const repository = {
    name: "alpha",
    rootPath: "C:/repos/alpha",
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

  const indexCoordinator: IndexCoordinator = {
    async ensureReady() {
      return {
        repo: repository.name,
        backend: "mock",
        state: "ready",
      };
    },
    async refreshRepository() {
      return {
        repo: repository.name,
        backend: "mock",
        state: "ready",
      };
    },
    async getStatus() {
      return [];
    },
  } as unknown as IndexCoordinator;

  const backend: LexicalSearchBackend = {
    kind: "mock",
    async prepareRepository() {
      return {
        repo: repository.name,
        backend: "mock",
        state: "ready",
      };
    },
    async searchRepository() {
      return [
        {
          path: "src/example.ts",
          startLine: 3,
          endLine: 5,
          snippet: "export const codeAtlas = true;",
          score: 99,
        },
      ];
    },
  };

  const service = new SearchService(registry, indexCoordinator, backend, {
    defaultLimit: 20,
    maxLimit: 100,
    maxBytesPerFile: 256 * 1024,
  });

  const response = await service.searchLexical({ query: "codeAtlas" });

  assert.equal(response.source_type, "lexical");
  assert.equal(response.results.length, 1);
  assert.deepEqual(response.results[0], {
    repo: "alpha",
    path: "src/example.ts",
    start_line: 3,
    end_line: 5,
    snippet: "export const codeAtlas = true;",
    score: 99,
    source_type: "lexical",
  });
});

test("SearchService reserves semantic and hybrid contracts with TODO markers", async () => {
  const registry: RepositoryRegistry = {
    async listRepositories() {
      return [];
    },
    async getRepository() {
      return null;
    },
    async registerRepository() {
      throw new Error("not used");
    },
  };

  const indexCoordinator = {
    async ensureReady() {
      throw new Error("not used");
    },
    async refreshRepository() {
      throw new Error("not used");
    },
    async getStatus() {
      return [];
    },
  } as unknown as IndexCoordinator;

  const backend: LexicalSearchBackend = {
    kind: "mock",
    async prepareRepository() {
      throw new Error("not used");
    },
    async searchRepository() {
      return [];
    },
  };

  const service = new SearchService(registry, indexCoordinator, backend, {
    defaultLimit: 20,
    maxLimit: 100,
    maxBytesPerFile: 256 * 1024,
  });

  const semantic = await service.searchSemantic({ query: "symbol" });
  const hybrid = await service.searchHybrid({ query: "symbol" });

  assert.equal(semantic.not_implemented, true);
  assert.match(semantic.message ?? "", /TODO: semantic_search/);
  assert.equal(hybrid.not_implemented, true);
  assert.match(hybrid.message ?? "", /TODO: hybrid_search/);
});