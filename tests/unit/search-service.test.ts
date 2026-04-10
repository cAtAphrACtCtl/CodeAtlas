import assert from "node:assert/strict";
import test from "node:test";

import type { IndexCoordinator } from "../../src/core/indexer/index-coordinator.js";
import type { RepositoryRegistry } from "../../src/core/registry/repository-registry.js";
import type { LexicalSearchBackend } from "../../src/core/search/lexical-search-backend.js";
import { SearchService } from "../../src/core/search/search-service.js";
import { scoreSymbolPath, SymbolSearchBackend } from "../../src/core/search/symbol-search-backend.js";

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
		new SymbolSearchBackend(backend),
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
		new SymbolSearchBackend(backend),
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

test("SearchService returns symbol-aware results from direct lexical queries", async () => {
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
		async searchRepository(_repository, request) {
			assert.equal(request.query, "\\bbuildAtlas\\b");
			return [
				{
					path: "src/example.ts",
					startLine: 10,
					endLine: 10,
					snippet: "export function buildAtlas() {",
					score: 99,
				},
			];
		},
	};

	const symbolSearchBackend = new SymbolSearchBackend(backend);

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
		async searchRepository(_repository, request) {
			assert.equal(request.query, "\\bcreateCodeAtlasServices\\b");
			return [
				{
					path: "src/runtime.ts",
					startLine: 1,
					endLine: 1,
					snippet: "export function createCodeAtlasServices() {",
					score: 100,
				},
				{
					path: "src/runtime.ts",
					startLine: 12,
					endLine: 12,
					snippet: "export interface CreateCodeAtlasServicesOptions {",
					score: 80,
				},
			];
		},
	};

	const symbolSearchBackend = new SymbolSearchBackend(backend);

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
		async searchRepository(repository, request) {
			assert.equal(request.query, "atlas");
			if (repository.name === "alpha") {
				return [
					{
						path: "src/example.ts",
						startLine: 1,
						endLine: 1,
						snippet: "export class helperAtlas {}",
						score: 90,
					},
				];
			}

			return [
				{
					path: "src/example.ts",
					startLine: 5,
					endLine: 5,
					snippet: "export function atlasBuilder() {",
					score: 100,
				},
			];
		},
	};

	const symbolSearchBackend = new SymbolSearchBackend(backend);

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
		new SymbolSearchBackend(backend),
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

test("SearchService symbol search only requires lexical readiness", async () => {
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
				backend: "zoekt",
				activeBackend: "ripgrep",
				fallbackActive: true,
				state: "indexing",
			};
		},
		async ensureSymbolReady() {
			throw new Error(
				"symbol readiness should not be required for find_symbol",
			);
		},
		async refreshRepository() {
			throw new Error("not used");
		},
		async getStatus() {
			return [];
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
		async searchRepository(_repository, request) {
			assert.equal(request.query, "\\batlas\\b");
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
		new SymbolSearchBackend(backend),
		{
			defaultLimit: 20,
			maxLimit: 100,
			maxBytesPerFile: 256 * 1024,
		},
	);

	const response = await service.findSymbols({ query: "atlas", exact: true });

	assert.equal(response.results.length, 1);
	assert.equal(response.results[0]?.name, "atlas");
	assert.equal(response.results[0]?.kind, "variable");
});

test("SearchService falls back to direct grep when a Zoekt symbol query returns no hits", async () => {
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
				backend: "zoekt",
				activeBackend: "zoekt",
				state: "ready",
			};
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

	const executedQueries: string[] = [];
	const zoektBackend: LexicalSearchBackend = {
		kind: "zoekt",
		async prepareRepository() {
			return {
				repo: repository.name,
				backend: "zoekt",
				state: "ready",
			};
		},
		async searchRepository(_repository, request) {
			executedQueries.push(`zoekt:${request.query}`);
			return [];
		},
	};

	const grepBackend: LexicalSearchBackend = {
		kind: "ripgrep",
		async prepareRepository() {
			return {
				repo: repository.name,
				backend: "ripgrep",
				state: "ready",
			};
		},
		async searchRepository(_repository, request) {
			executedQueries.push(`ripgrep:${request.query}`);
			return [
				{
					path: "src/example.ts",
					startLine: 8,
					endLine: 8,
					snippet: "export function registerPopoverNavigation() {",
					score: 90,
				},
			];
		},
	};

	const service = new SearchService(
		registry,
		indexCoordinator,
		zoektBackend,
		new SymbolSearchBackend(zoektBackend, grepBackend),
		{
			defaultLimit: 20,
			maxLimit: 100,
			maxBytesPerFile: 256 * 1024,
		},
	);

	const response = await service.findSymbols({
		query: "registerPopoverNavigation",
		exact: true,
	});

	assert.deepEqual(executedQueries, [
		"zoekt:sym:registerPopoverNavigation",
		"ripgrep:\\bregisterPopoverNavigation\\b",
	]);
	assert.equal(response.results.length, 1);
	assert.equal(response.results[0]?.name, "registerPopoverNavigation");
	assert.equal(response.results[0]?.kind, "function");
});

test("SearchService exact symbol search handles identifiers with dollar prefixes", async () => {
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
				backend: "ripgrep",
				activeBackend: "ripgrep",
				state: "ready",
			};
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
		kind: "ripgrep",
		async prepareRepository() {
			return {
				repo: repository.name,
				backend: "ripgrep",
				state: "ready",
			};
		},
		async searchRepository(_repository, request) {
			assert.equal(request.query, "(^|[^\\w$])\\$atlas($|[^\\w$])");
			return [
				{
					path: "src/example.ts",
					startLine: 1,
					endLine: 1,
					snippet: "export const $atlas = true;",
					score: 100,
				},
			];
		},
	};

	const service = new SearchService(
		registry,
		indexCoordinator,
		backend,
		new SymbolSearchBackend(backend),
		{
			defaultLimit: 20,
			maxLimit: 100,
			maxBytesPerFile: 256 * 1024,
		},
	);

	const response = await service.findSymbols({ query: "$atlas", exact: true });

	assert.equal(response.results.length, 1);
	assert.equal(response.results[0]?.name, "$atlas");
	assert.equal(response.results[0]?.kind, "variable");
});

test("SearchService infers class kind for abstract generic class declarations", async () => {
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
				backend: "ripgrep",
				activeBackend: "ripgrep",
				state: "ready",
			};
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
		kind: "ripgrep",
		async prepareRepository() {
			return {
				repo: repository.name,
				backend: "ripgrep",
				state: "ready",
			};
		},
		async searchRepository() {
			return [
				{
					path: "src/example.ts",
					startLine: 4,
					endLine: 4,
					snippet: "export abstract class AtlasService<T> {",
					score: 100,
				},
			];
		},
	};

	const service = new SearchService(
		registry,
		indexCoordinator,
		backend,
		new SymbolSearchBackend(backend),
		{
			defaultLimit: 20,
			maxLimit: 100,
			maxBytesPerFile: 256 * 1024,
		},
	);

	const response = await service.findSymbols({
		query: "AtlasService",
		exact: true,
	});

	assert.equal(response.results.length, 1);
	assert.equal(response.results[0]?.name, "AtlasService");
	assert.equal(response.results[0]?.kind, "class");
});

test("scoreSymbolPath returns 0 for normal source files", () => {
	assert.equal(scoreSymbolPath("src/core/search/symbol-search-backend.ts"), 0);
	assert.equal(scoreSymbolPath("lib/utils/helpers.ts"), 0);
	assert.equal(scoreSymbolPath("index.ts"), 0);
});

test("scoreSymbolPath penalises test files and directories", () => {
	assert.equal(scoreSymbolPath("tests/unit/foo.test.ts"), -20);
	assert.equal(scoreSymbolPath("src/foo.spec.ts"), -20);
	assert.equal(scoreSymbolPath("__tests__/bar.ts"), -20);
	assert.equal(scoreSymbolPath("spec/integration/baz.ts"), -20);
});

test("scoreSymbolPath penalises build artifact and vendor directories", () => {
	assert.equal(scoreSymbolPath("bin/Release/foo.dll"), -30);
	assert.equal(scoreSymbolPath("obj/Debug/bar.ts"), -30);
	assert.equal(scoreSymbolPath("publish/app.js"), -30);
	assert.equal(scoreSymbolPath("dist/bundle.js"), -30);
	assert.equal(scoreSymbolPath("node_modules/lodash/index.js"), -30);
	assert.equal(scoreSymbolPath("paket-files/vendor/lib.ts"), -30);
});

test("scoreSymbolPath ranks source results above test results", () => {
	const sourceScore = 120 + scoreSymbolPath("src/core/MyService.ts");
	const testScore = 120 + scoreSymbolPath("tests/unit/MyService.test.ts");
	assert.ok(sourceScore > testScore, "source file should outrank test file at same name-score");
});

test("SearchService path-aware ranking places source file above test file for same query", async () => {
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
				backend: "ripgrep",
				activeBackend: "ripgrep",
				state: "ready",
			};
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

	// Backend returns the test-file hit first, then the source-file hit
	const backend: LexicalSearchBackend = {
		kind: "ripgrep",
		async prepareRepository() {
			return { repo: repository.name, backend: "ripgrep", state: "ready" };
		},
		async searchRepository() {
			return [
				{
					path: "tests/unit/MyService.test.ts",
					startLine: 1,
					endLine: 1,
					snippet: "class MyService {",
					score: 100,
				},
				{
					path: "src/core/MyService.ts",
					startLine: 3,
					endLine: 3,
					snippet: "export class MyService {",
					score: 100,
				},
			];
		},
	};

	const service = new SearchService(
		registry,
		indexCoordinator,
		backend,
		new SymbolSearchBackend(backend),
		{
			defaultLimit: 20,
			maxLimit: 100,
			maxBytesPerFile: 256 * 1024,
		},
	);

	const response = await service.findSymbols({ query: "MyService", exact: true });

	assert.equal(response.results.length, 2);
	// Source file must rank above the test file
	assert.equal(response.results[0]?.path, "src/core/MyService.ts");
	assert.equal(response.results[1]?.path, "tests/unit/MyService.test.ts");
});

