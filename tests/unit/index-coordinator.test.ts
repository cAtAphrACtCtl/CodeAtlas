import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { IndexCoordinator } from "../../src/core/indexer/index-coordinator.js";
import { getRepoIndexDir } from "../../src/core/indexer/repo-artifact-path.js";
import type {
	MetadataStore,
	RepositoryIndexStatus,
} from "../../src/core/metadata/metadata-store.js";
import type { RepositoryRegistry } from "../../src/core/registry/repository-registry.js";
import type { LexicalSearchBackend } from "../../src/core/search/lexical-search-backend.js";
import { TypeScriptSymbolExtractor } from "../../src/core/search/symbol-extractor.js";
import { FileSymbolIndexStore } from "../../src/core/search/symbol-index-store.js";
import { ZoektLexicalSearchBackend } from "../../src/core/search/zoekt-lexical-search-backend.js";

function createMetadataStore(
	backing = new Map<string, RepositoryIndexStatus>(),
): MetadataStore {
	return {
		async listIndexStatuses() {
			return [...backing.values()];
		},
		async getIndexStatus(repo) {
			return backing.get(repo) ?? null;
		},
		async setIndexStatus(status) {
			backing.set(status.repo, status);
		},
	};
}

test("IndexCoordinator refreshes repository status independently", async (t) => {
	const tempRepoRoot = await mkdtemp(path.join(os.tmpdir(), "codeatlas-repo-"));
	t.after(async () => {
		await rm(tempRepoRoot, { recursive: true, force: true });
	});
	await mkdir(path.join(tempRepoRoot, "src"), { recursive: true });
	await writeFile(
		path.join(tempRepoRoot, "src", "repo-a.ts"),
		"export function repoA() { return true; }\n",
		"utf8",
	);

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

	const metadataStore = createMetadataStore();

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
	assert.equal(statuses[0]?.symbolState, "ready");
});

test("IndexCoordinator lexical readiness does not require symbol readiness", async () => {
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

	const statuses = new Map<string, RepositoryIndexStatus>([
		[
			repository.name,
			{
				repo: repository.name,
				backend: "mock",
				state: "ready",
				symbolState: "stale",
				lastIndexedAt: "2026-03-25T00:00:00.000Z",
				symbolLastIndexedAt: "2026-03-25T00:00:00.000Z",
			},
		],
	]);

	let prepareCalls = 0;
	const backend: LexicalSearchBackend = {
		kind: "mock",
		async prepareRepository(candidate) {
			prepareCalls += 1;
			return {
				repo: candidate.name,
				backend: "mock",
				state: "ready",
			};
		},
		async searchRepository() {
			return [];
		},
	};

	const coordinator = new IndexCoordinator(
		registry,
		createMetadataStore(statuses),
		backend,
		new TypeScriptSymbolExtractor(),
		new FileSymbolIndexStore("C:/tmp/codeatlas-unused"),
	);

	const ready = await coordinator.ensureLexicalReady(repository.name);

	assert.equal(ready.state, "ready");
	assert.equal(ready.symbolState, "stale");
	assert.equal(prepareCalls, 0);
});

test("IndexCoordinator reindexes when stored ready metadata points to a missing Zoekt repo directory", async (t) => {
	const repositoryRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-zoekt-ready-"),
	);
	const zoektRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-zoekt-index-"),
	);
	const symbolRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-symbols-ready-"),
	);
	t.after(async () => {
		await rm(repositoryRoot, { recursive: true, force: true });
		await rm(zoektRoot, { recursive: true, force: true });
		await rm(symbolRoot, { recursive: true, force: true });
	});

	await mkdir(path.join(repositoryRoot, "src"), { recursive: true });
	await writeFile(
		path.join(repositoryRoot, "src", "repo-a.ts"),
		"export const value = 1;\n",
		"utf8",
	);

	const repository = {
		name: "repo-a",
		rootPath: repositoryRoot,
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

	const statuses = new Map<string, RepositoryIndexStatus>([
		[
			repository.name,
			{
				repo: repository.name,
				backend: "zoekt",
				configuredBackend: "zoekt",
				state: "ready",
				symbolState: "ready",
				lastIndexedAt: "2026-03-25T00:00:00.000Z",
				symbolLastIndexedAt: "2026-03-25T00:00:00.000Z",
			},
		],
	]);

	let prepareCalls = 0;
	const backend = new ZoektLexicalSearchBackend(
		{
			kind: "zoekt",
			zoektIndexExecutable: "missing-zoekt-index",
			zoektSearchExecutable: "missing-zoekt-search",
			indexRoot: zoektRoot,
			allowBootstrapFallback: true,
			bootstrapFallback: {
				kind: "ripgrep",
				executable: "rg",
				fallbackToNaiveScan: true,
			},
		},
		{
			kind: "ripgrep",
			async prepareRepository(candidate) {
				prepareCalls += 1;

				const repoDir = getRepoIndexDir(
					zoektRoot,
					candidate.name,
					candidate.rootPath,
				);
				await mkdir(repoDir, { recursive: true });
				await writeFile(
					path.join(repoDir, "repo.zoekt"),
					"placeholder shard",
					"utf8",
				);

				return {
					repo: candidate.name,
					backend: "ripgrep",
					state: "ready",
					detail: "fallback ready",
				};
			},
			async searchRepository() {
				return [];
			},
			async verifyRepositoryReady() {
				return { ready: true };
			},
		},
	);

	const coordinator = new IndexCoordinator(
		registry,
		createMetadataStore(statuses),
		backend,
		new TypeScriptSymbolExtractor(),
		new FileSymbolIndexStore(symbolRoot),
	);

	const ready = await coordinator.ensureLexicalReady(repository.name);

	assert.equal(prepareCalls, 1);
	assert.equal(ready.state, "ready");
	assert.equal(statuses.get(repository.name)?.backend, "ripgrep");
	assert.equal(statuses.get(repository.name)?.state, "ready");
});

test("IndexCoordinator keeps a stored ready status when the active backend confirms fallback-backed readiness", async (t) => {
	const repositoryRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-fallback-ready-"),
	);
	t.after(async () => {
		await rm(repositoryRoot, { recursive: true, force: true });
	});

	const repository = {
		name: "repo-a",
		rootPath: repositoryRoot,
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

	const statuses = new Map<string, RepositoryIndexStatus>([
		[
			repository.name,
			{
				repo: repository.name,
				backend: "ripgrep",
				configuredBackend: "zoekt",
				state: "ready",
				symbolState: "ready",
				lastIndexedAt: "2026-03-25T00:00:00.000Z",
				symbolLastIndexedAt: "2026-03-25T00:00:00.000Z",
			},
		],
	]);

	let prepareCalls = 0;
	let verifyCalls = 0;
	const backend = new ZoektLexicalSearchBackend(
		{
			kind: "zoekt",
			zoektIndexExecutable: "missing-zoekt-index",
			zoektSearchExecutable: "missing-zoekt-search",
			indexRoot: "C:/indexes/zoekt",
			allowBootstrapFallback: true,
			bootstrapFallback: {
				kind: "ripgrep",
				executable: "rg",
				fallbackToNaiveScan: true,
			},
		},
		{
			kind: "ripgrep",
			async prepareRepository(candidate) {
				prepareCalls += 1;
				return {
					repo: candidate.name,
					backend: "ripgrep",
					state: "ready",
				};
			},
			async searchRepository() {
				return [];
			},
			async verifyRepositoryReady() {
				verifyCalls += 1;
				return { ready: true };
			},
		},
	);

	const coordinator = new IndexCoordinator(
		registry,
		createMetadataStore(statuses),
		backend,
		new TypeScriptSymbolExtractor(),
		new FileSymbolIndexStore("C:/tmp/codeatlas-unused"),
	);

	const ready = await coordinator.ensureLexicalReady(repository.name);

	assert.equal(ready.backend, "ripgrep");
	assert.equal(prepareCalls, 0);
	assert.equal(verifyCalls, 1);
});

test("IndexCoordinator refreshes when stored ready metadata was produced by a different backend", async (t) => {
	const repositoryRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-backend-switch-"),
	);
	t.after(async () => {
		await rm(repositoryRoot, { recursive: true, force: true });
	});

	const repository = {
		name: "repo-a",
		rootPath: repositoryRoot,
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

	const statuses = new Map<string, RepositoryIndexStatus>([
		[
			repository.name,
			{
				repo: repository.name,
				backend: "ripgrep",
				configuredBackend: "ripgrep",
				state: "ready",
				symbolState: "ready",
				lastIndexedAt: "2026-03-25T00:00:00.000Z",
				symbolLastIndexedAt: "2026-03-25T00:00:00.000Z",
			},
		],
	]);

	let prepareCalls = 0;
	const backend = new ZoektLexicalSearchBackend(
		{
			kind: "zoekt",
			zoektIndexExecutable: "missing-zoekt-index",
			zoektSearchExecutable: "missing-zoekt-search",
			indexRoot: "C:/indexes/zoekt",
			allowBootstrapFallback: true,
			bootstrapFallback: {
				kind: "ripgrep",
				executable: "rg",
				fallbackToNaiveScan: true,
			},
		},
		{
			kind: "ripgrep",
			async prepareRepository(candidate) {
				prepareCalls += 1;
				return {
					repo: candidate.name,
					backend: "ripgrep",
					state: "ready",
					detail: "fallback ready",
				};
			},
			async searchRepository() {
				return [];
			},
			async verifyRepositoryReady() {
				return { ready: true };
			},
		},
	);

	const coordinator = new IndexCoordinator(
		registry,
		createMetadataStore(statuses),
		backend,
		new TypeScriptSymbolExtractor(),
		new FileSymbolIndexStore("C:/tmp/codeatlas-unused"),
	);

	const ready = await coordinator.ensureLexicalReady(repository.name);

	assert.equal(prepareCalls, 1);
	assert.equal(ready.backend, "ripgrep");
	assert.equal(statuses.get(repository.name)?.backend, "ripgrep");
});

test("IndexCoordinator preserves the fallback backend while recording the configured backend after refresh", async (t) => {
	const repositoryRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-configured-backend-"),
	);
	const symbolRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-configured-backend-symbols-"),
	);
	t.after(async () => {
		await rm(repositoryRoot, { recursive: true, force: true });
		await rm(symbolRoot, { recursive: true, force: true });
	});

	await mkdir(path.join(repositoryRoot, "src"), { recursive: true });
	await writeFile(
		path.join(repositoryRoot, "src", "repo-a.ts"),
		"export const value = 1;\n",
		"utf8",
	);

	const repository = {
		name: "repo-a",
		rootPath: repositoryRoot,
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

	const statuses = new Map<string, RepositoryIndexStatus>();
	const backend: LexicalSearchBackend = {
		kind: "zoekt",
		async prepareRepository(candidate) {
			return {
				repo: candidate.name,
				backend: "ripgrep",
				state: "ready",
				detail: "fallback ready",
			};
		},
		async searchRepository() {
			return [];
		},
	};

	const coordinator = new IndexCoordinator(
		registry,
		createMetadataStore(statuses),
		backend,
		new TypeScriptSymbolExtractor(),
		new FileSymbolIndexStore(symbolRoot),
	);

	const ready = await coordinator.refreshRepository(repository.name);

	assert.equal(ready.backend, "ripgrep");
	assert.equal(ready.configuredBackend, "zoekt");
	assert.equal(statuses.get(repository.name)?.backend, "ripgrep");
	assert.equal(statuses.get(repository.name)?.configuredBackend, "zoekt");
});

test("IndexCoordinator can mark a repository stale", async () => {
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

	const statuses = new Map<string, RepositoryIndexStatus>([
		[
			repository.name,
			{
				repo: repository.name,
				backend: "mock",
				state: "ready",
				symbolState: "ready",
				lastIndexedAt: "2026-03-25T00:00:00.000Z",
				symbolLastIndexedAt: "2026-03-25T00:00:00.000Z",
				symbolCount: 3,
			},
		],
	]);

	const backend: LexicalSearchBackend = {
		kind: "mock",
		async prepareRepository(candidate) {
			return {
				repo: candidate.name,
				backend: "mock",
				state: "ready",
			};
		},
		async searchRepository() {
			return [];
		},
	};

	const coordinator = new IndexCoordinator(
		registry,
		createMetadataStore(statuses),
		backend,
		new TypeScriptSymbolExtractor(),
		new FileSymbolIndexStore("C:/tmp/codeatlas-unused"),
	);

	const stale = await coordinator.markRepositoryStale(
		repository.name,
		"Repository updated on disk",
	);

	assert.equal(stale.state, "stale");
	assert.equal(stale.symbolState, "stale");
	assert.equal(stale.detail, "Repository updated on disk");
	assert.equal(statuses.get(repository.name)?.state, "stale");
});

test("IndexCoordinator deduplicates concurrent refresh requests", async (t) => {
	const tempRepoRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-repo-refresh-"),
	);
	t.after(async () => {
		await rm(tempRepoRoot, { recursive: true, force: true });
	});
	await mkdir(path.join(tempRepoRoot, "src"), { recursive: true });
	await writeFile(
		path.join(tempRepoRoot, "src", "repo-a.ts"),
		"export function repoA() { return true; }\n",
		"utf8",
	);

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

	let prepareCalls = 0;
	const backend: LexicalSearchBackend = {
		kind: "mock",
		async prepareRepository(candidate) {
			prepareCalls += 1;
			await new Promise((resolve) => setTimeout(resolve, 20));
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

	const tempRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-symbols-refresh-"),
	);
	t.after(async () => {
		await rm(tempRoot, { recursive: true, force: true });
	});

	const coordinator = new IndexCoordinator(
		registry,
		createMetadataStore(),
		backend,
		new TypeScriptSymbolExtractor(),
		new FileSymbolIndexStore(tempRoot),
	);

	const [first, second] = await Promise.all([
		coordinator.refreshRepository(repository.name),
		coordinator.refreshRepository(repository.name),
	]);

	assert.equal(first.state, "ready");
	assert.equal(second.state, "ready");
	assert.equal(prepareCalls, 1);
});

