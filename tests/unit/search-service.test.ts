import assert from "node:assert/strict";
import test from "node:test";

import type { IndexCoordinator } from "../../src/core/indexer/index-coordinator.js";
import type { RepositoryRegistry } from "../../src/core/registry/repository-registry.js";
import type { LexicalSearchBackend } from "../../src/core/search/lexical-search-backend.js";
import { SearchService } from "../../src/core/search/search-service.js";
import { SymbolSearchBackend } from "../../src/core/search/symbol-search-backend.js";

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
		async ensureLexicalReady() {
			return {
				repo: repository.name,
				backend: "mock",
				state: "ready",
			};
		},
		async ensureSymbolReady() {
			return {
				repo: repository.name,
				backend: "mock",
				state: "ready",
				symbolState: "ready",
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
		async recordLexicalSearchObservation() {},
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

	const service = new SearchService(
		registry,
		indexCoordinator,
		backend,
		new SymbolSearchBackend({
			async getSymbols() {
				return [];
			},
			async setSymbols() {},
		}),
		{
			defaultLimit: 20,
			maxLimit: 100,
			maxBytesPerFile: 256 * 1024,
		},
	);

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

test("SearchService records lexical search metrics using the active backend from readiness status", async () => {
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

	const observations: Array<{ repoName: string; durationMs: number; backend?: string }> = [];
	const indexCoordinator: IndexCoordinator = {
		async ensureReady() {
			return {
				repo: repository.name,
				backend: "zoekt",
				activeBackend: "ripgrep",
				fallbackActive: true,
				state: "indexing",
				symbolState: "not_indexed",
			};
		},
		async ensureLexicalReady() {
			return {
				repo: repository.name,
				backend: "zoekt",
				activeBackend: "ripgrep",
				fallbackActive: true,
				state: "indexing",
				symbolState: "not_indexed",
			};
		},
		async ensureSymbolReady() {
			return {
				repo: repository.name,
				backend: "zoekt",
				state: "ready",
				symbolState: "ready",
			};
		},
		async refreshRepository() {
			return {
				repo: repository.name,
				backend: "zoekt",
				state: "ready",
			};
		},
		async getStatus() {
			return [];
		},
		async recordLexicalSearchObservation(repoName, observation) {
			observations.push({ repoName, ...observation });
		},
	} as unknown as IndexCoordinator;

	const backend: LexicalSearchBackend = {
		kind: "zoekt",
		async prepareRepository() {
			return {
				repo: repository.name,
				backend: "zoekt",
				state: "ready",
			};
		},
		async searchRepository() {
			return [
				{
					path: "src/example.ts",
					startLine: 10,
					endLine: 10,
					snippet: "MockCargoWiseClientServices",
					score: 99,
				},
			];
		},
	};

	const service = new SearchService(
		registry,
		indexCoordinator,
		backend,
		new SymbolSearchBackend({
			async getSymbols() {
				return [];
			},
			async setSymbols() {},
		}),
		{
			defaultLimit: 20,
			maxLimit: 100,
			maxBytesPerFile: 256 * 1024,
		},
	);

	await service.searchLexical({ query: "MockCargoWiseClientServices" });

	assert.equal(observations.length, 1);
	assert.equal(observations[0]?.repoName, "alpha");
	assert.equal(observations[0]?.backend, "ripgrep");
	assert.equal(typeof observations[0]?.durationMs, "number");
	assert.ok((observations[0]?.durationMs ?? -1) >= 0);
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
		async ensureLexicalReady() {
			throw new Error("not used");
		},
		async ensureSymbolReady() {
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

	const service = new SearchService(
		registry,
		indexCoordinator,
		backend,
		new SymbolSearchBackend({
			async getSymbols() {
				return [];
			},
			async setSymbols() {},
		}),
		{
			defaultLimit: 20,
			maxLimit: 100,
			maxBytesPerFile: 256 * 1024,
		},
	);

	const semantic = await service.searchSemantic({ query: "symbol" });
	const hybrid = await service.searchHybrid({ query: "symbol" });

	assert.equal(semantic.not_implemented, true);
	assert.match(semantic.message ?? "", /TODO: semantic_search/);
	assert.equal(hybrid.not_implemented, true);
	assert.match(hybrid.message ?? "", /TODO: hybrid_search/);
});

test("SearchService returns symbol-aware results from the local symbol index", async () => {
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

	const indexCoordinator = {
		async ensureReady() {
			return {
				repo: repository.name,
				backend: "mock",
				state: "ready",
				symbolState: "ready",
			};
		},
		async ensureLexicalReady() {
			return {
				repo: repository.name,
				backend: "mock",
				state: "ready",
			};
		},
		async ensureSymbolReady() {
			return {
				repo: repository.name,
				backend: "mock",
				state: "ready",
				symbolState: "ready",
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
			return [];
		},
	};

	const symbolSearchBackend = new SymbolSearchBackend({
		async getSymbols() {
			return [
				{
					repo: "alpha",
					path: "src/example.ts",
					name: "buildAtlas",
					kind: "function",
					start_line: 10,
					end_line: 12,
				},
			];
		},
		async setSymbols() {},
	});

	const service = new SearchService(
		registry,
		indexCoordinator,
		backend,
		symbolSearchBackend,
		{
			defaultLimit: 20,
			maxLimit: 100,
			maxBytesPerFile: 256 * 1024,
		},
	);

	const response = await service.findSymbols({
		query: "buildAtlas",
		exact: true,
	});

	assert.equal(response.results.length, 1);
	assert.equal(response.results[0]?.name, "buildAtlas");
	assert.equal(response.results[0]?.kind, "function");
});

test("SearchService exact symbol search only returns exact name matches", async () => {
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

	const indexCoordinator = {
		async ensureReady() {
			return {
				repo: repository.name,
				backend: "mock",
				state: "ready",
				symbolState: "ready",
			};
		},
		async ensureLexicalReady() {
			return {
				repo: repository.name,
				backend: "mock",
				state: "ready",
			};
		},
		async ensureSymbolReady() {
			return {
				repo: repository.name,
				backend: "mock",
				state: "ready",
				symbolState: "ready",
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
			return [];
		},
	};

	const symbolSearchBackend = new SymbolSearchBackend({
		async getSymbols() {
			return [
				{
					repo: "alpha",
					path: "src/runtime.ts",
					name: "createCodeAtlasServices",
					kind: "function",
					start_line: 1,
					end_line: 10,
				},
				{
					repo: "alpha",
					path: "src/runtime.ts",
					name: "CreateCodeAtlasServicesOptions",
					kind: "interface",
					start_line: 12,
					end_line: 15,
				},
				{
					repo: "alpha",
					path: "src/runtime.ts",
					name: "baseDir",
					kind: "property",
					start_line: 13,
					end_line: 13,
					container_name: "CreateCodeAtlasServicesOptions",
				},
			];
		},
		async setSymbols() {},
	});

	const service = new SearchService(
		registry,
		indexCoordinator,
		backend,
		symbolSearchBackend,
		{
			defaultLimit: 20,
			maxLimit: 100,
			maxBytesPerFile: 256 * 1024,
		},
	);

	const response = await service.findSymbols({
		query: "createCodeAtlasServices",
		exact: true,
	});

	assert.equal(response.results.length, 1);
	assert.equal(response.results[0]?.name, "createCodeAtlasServices");
	assert.equal(response.results[0]?.kind, "function");
});

test("SearchService ranks symbol results across repositories by score", async () => {
	const alpha = {
		name: "alpha",
		rootPath: "C:/repos/alpha",
		registeredAt: new Date().toISOString(),
	};
	const beta = {
		name: "beta",
		rootPath: "C:/repos/beta",
		registeredAt: new Date().toISOString(),
	};

	const registry: RepositoryRegistry = {
		async listRepositories() {
			return [alpha, beta];
		},
		async getRepository(name) {
			return name === alpha.name ? alpha : name === beta.name ? beta : null;
		},
		async registerRepository() {
			return alpha;
		},
	};

	const indexCoordinator = {
		async ensureReady() {
			return {
				repo: alpha.name,
				backend: "mock",
				state: "ready",
				symbolState: "ready",
			};
		},
		async ensureLexicalReady() {
			return {
				repo: alpha.name,
				backend: "mock",
				state: "ready",
			};
		},
		async ensureSymbolReady() {
			return {
				repo: alpha.name,
				backend: "mock",
				state: "ready",
				symbolState: "ready",
			};
		},
		async refreshRepository() {
			return {
				repo: alpha.name,
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
				repo: alpha.name,
				backend: "mock",
				state: "ready",
			};
		},
		async searchRepository() {
			return [];
		},
	};

	const symbolSearchBackend = new SymbolSearchBackend({
		async getSymbols(repo) {
			if (repo === "alpha") {
				return [
					{
						repo: "alpha",
						path: "src/example.ts",
						name: "helperAtlas",
						kind: "class",
						start_line: 1,
						end_line: 3,
					},
				];
			}

			return [
				{
					repo: "beta",
					path: "src/example.ts",
					name: "atlasBuilder",
					kind: "function",
					start_line: 5,
					end_line: 7,
				},
			];
		},
		async setSymbols() {},
	});

	const service = new SearchService(
		registry,
		indexCoordinator,
		backend,
		symbolSearchBackend,
		{
			defaultLimit: 20,
			maxLimit: 100,
			maxBytesPerFile: 256 * 1024,
		},
	);

	const response = await service.findSymbols({ query: "atlas" });

	assert.equal(response.results.length, 2);
	assert.equal(response.results[0]?.repo, "beta");
	assert.equal(response.results[0]?.name, "atlasBuilder");
});

test("SearchService lexical search only requires lexical readiness", async () => {
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

	const indexCoordinator = {
		async ensureReady() {
			throw new Error("not used");
		},
		async ensureLexicalReady() {
			return {
				repo: repository.name,
				backend: "mock",
				state: "ready",
			};
		},
		async ensureSymbolReady() {
			throw new Error(
				"symbol readiness should not be required for lexical search",
			);
		},
		async refreshRepository() {
			throw new Error("not used");
		},
		async getStatus() {
			return [];
		},
		async recordLexicalSearchObservation() {},
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
					startLine: 1,
					endLine: 1,
					snippet: "export const atlas = true;",
					score: 50,
				},
			];
		},
	};

	const service = new SearchService(
		registry,
		indexCoordinator,
		backend,
		new SymbolSearchBackend({
			async getSymbols() {
				return [];
			},
			async setSymbols() {},
		}),
		{
			defaultLimit: 20,
			maxLimit: 100,
			maxBytesPerFile: 256 * 1024,
		},
	);

	const response = await service.searchLexical({ query: "atlas" });

	assert.equal(response.results.length, 1);
	assert.equal(response.results[0]?.path, "src/example.ts");
});

