import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { IndexCoordinator } from "../../src/core/indexer/index-coordinator.js";
import type { RepositoryIndexStatus } from "../../src/core/metadata/metadata-store.js";
import type { RepositoryRegistry } from "../../src/core/registry/repository-registry.js";
import type { LexicalSearchBackend } from "../../src/core/search/lexical-search-backend.js";
import { TypeScriptSymbolExtractor } from "../../src/core/search/symbol-extractor.js";
import { FileSymbolIndexStore } from "../../src/core/search/symbol-index-store.js";

function createDeferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, resolve, reject };
}

async function waitForCondition(
	condition: () => boolean,
	attempts = 20,
	delayMs = 10,
): Promise<void> {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		if (condition()) {
			return;
		}

		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}

	assert.fail("Condition was not satisfied before timeout");
}

test("IndexCoordinator deleteRepositoryIndex reports removed targets", async (t) => {
	const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codeatlas-lifecycle-"));
	t.after(async () => {
		await rm(tempRoot, { recursive: true, force: true });
	});

	const repositoryRoot = path.join(tempRoot, "repo");
	await mkdir(repositoryRoot, { recursive: true });
	await writeFile(path.join(repositoryRoot, "index.ts"), "export const value = 1;\n", "utf8");

	const repository = {
		name: "sample",
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
		async unregisterRepository(name) {
			return name === repository.name ? repository : null;
		},
	};
	const statuses = new Map<string, RepositoryIndexStatus>();
	const metadataStore = {
		async listIndexStatuses() {
			return [...statuses.values()];
		},
		async getIndexStatus(repo: string) {
			return statuses.get(repo) ?? null;
		},
		async setIndexStatus(status: RepositoryIndexStatus) {
			statuses.set(status.repo, status);
		},
		async deleteIndexStatus(repo: string) {
			const removed = statuses.get(repo) ?? null;
			statuses.delete(repo);
			return removed;
		},
	};
	let lexicalDeletes = 0;
	const backend: LexicalSearchBackend = {
		kind: "mock",
		async prepareRepository() {
			return { repo: repository.name, backend: "mock", state: "ready" };
		},
		async deleteRepositoryArtifacts() {
			lexicalDeletes += 1;
		},
		async searchRepository() {
			return [];
		},
	};
	const symbolStore = new FileSymbolIndexStore(tempRoot);
	await symbolStore.setSymbols(repository.name, []);

	const coordinator = new IndexCoordinator(
		registry,
		metadataStore,
		backend,
		new TypeScriptSymbolExtractor(),
		symbolStore,
	);

	const result = await coordinator.deleteRepositoryIndex("sample", "all");

	assert.equal(result.removedLexical, true);
	assert.equal(result.removedSymbols, true);
	assert.equal(result.errors, undefined);
	assert.equal(lexicalDeletes, 1);
	assert.equal((await coordinator.getStatus("sample"))[0]?.state, "not_indexed");
	assert.equal((await coordinator.getStatus("sample"))[0]?.symbolState, "not_indexed");
});

test("IndexCoordinator blocks lifecycle mutation while refresh is in-flight", async (t) => {
	const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codeatlas-lifecycle-race-"));
	t.after(async () => {
		await rm(tempRoot, { recursive: true, force: true });
	});

	const repositoryRoot = path.join(tempRoot, "repo");
	await mkdir(repositoryRoot, { recursive: true });
	await writeFile(path.join(repositoryRoot, "index.ts"), "export const value = 1;\n", "utf8");

	const repository = {
		name: "sample",
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
		async unregisterRepository(name) {
			return name === repository.name ? repository : null;
		},
	};
	const statuses = new Map<string, RepositoryIndexStatus>();
	const metadataStore = {
		async listIndexStatuses() {
			return [...statuses.values()];
		},
		async getIndexStatus(repo: string) {
			return statuses.get(repo) ?? null;
		},
		async setIndexStatus(status: RepositoryIndexStatus) {
			statuses.set(status.repo, status);
		},
		async deleteIndexStatus(repo: string) {
			const removed = statuses.get(repo) ?? null;
			statuses.delete(repo);
			return removed;
		},
	};
	const deferred = createDeferred<RepositoryIndexStatus>();
	const backend: LexicalSearchBackend = {
		kind: "mock",
		async prepareRepository() {
			return deferred.promise;
		},
		async deleteRepositoryArtifacts() {
			return;
		},
		async searchRepository() {
			return [];
		},
	};

	const coordinator = new IndexCoordinator(
		registry,
		metadataStore,
		backend,
		new TypeScriptSymbolExtractor(),
		new FileSymbolIndexStore(tempRoot),
	);

	const refreshPromise = coordinator.refreshRepository("sample");
	await new Promise((resolve) => setImmediate(resolve));

	await assert.rejects(
		() => coordinator.deleteRepositoryIndex("sample", "all"),
		/in-flight/,
	);

	deferred.resolve({
		repo: repository.name,
		backend: "mock",
		state: "ready",
	});
	await refreshPromise;
});

test("IndexCoordinator persists error status when background refresh throws", async (t) => {
	const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codeatlas-lifecycle-fail-"));
	t.after(async () => {
		await rm(tempRoot, { recursive: true, force: true });
	});

	const repositoryRoot = path.join(tempRoot, "repo");
	await mkdir(repositoryRoot, { recursive: true });

	const repository = {
		name: "sample",
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
	const metadataStore = {
		async listIndexStatuses() {
			return [...statuses.values()];
		},
		async getIndexStatus(repo: string) {
			return statuses.get(repo) ?? null;
		},
		async setIndexStatus(status: RepositoryIndexStatus) {
			statuses.set(status.repo, status);
		},
	};
	const backend: LexicalSearchBackend = {
		kind: "mock",
		async prepareRepository() {
			throw new Error("boom");
		},
		async searchRepository() {
			return [];
		},
	};

	const coordinator = new IndexCoordinator(
		registry,
		metadataStore,
		backend,
		new TypeScriptSymbolExtractor(),
		new FileSymbolIndexStore(tempRoot),
	);

	const submitted = await coordinator.submitRefresh("sample");
	assert.equal(submitted.state, "indexing");

	for (let attempt = 0; attempt < 10; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 10));
		const status = statuses.get("sample");
		if (status?.state === "error") {
			assert.equal(status.reason, "refresh_failed");
			assert.equal(status.symbolState, "not_indexed");
			assert.match(status.detail ?? "", /Repository refresh failed: Error: boom/);
			assert.equal(typeof status.lastRefreshDurationMs, "number");
			return;
		}
	}

	assert.fail("background refresh did not transition to error state");
});

test("IndexCoordinator marks lexical state ready before symbol extraction completes", async (t) => {
	const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codeatlas-lifecycle-symbol-"));
	t.after(async () => {
		await rm(tempRoot, { recursive: true, force: true });
	});

	const repositoryRoot = path.join(tempRoot, "repo");
	await mkdir(repositoryRoot, { recursive: true });
	await writeFile(path.join(repositoryRoot, "index.ts"), "export const value = 1;\n", "utf8");

	const repository = {
		name: "sample",
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
	const metadataStore = {
		async listIndexStatuses() {
			return [...statuses.values()];
		},
		async getIndexStatus(repo: string) {
			return statuses.get(repo) ?? null;
		},
		async setIndexStatus(status: RepositoryIndexStatus) {
			statuses.set(status.repo, status);
		},
	};
	const deferredSymbols = createDeferred<any[]>();
	const backend: LexicalSearchBackend = {
		kind: "mock",
		async prepareRepository() {
			return {
				repo: repository.name,
				backend: "mock",
				state: "ready",
				lastIndexedAt: new Date().toISOString(),
			};
		},
		async searchRepository() {
			return [];
		},
	};
	const symbolExtractor = {
		async extractRepository() {
			return deferredSymbols.promise;
		},
	} as unknown as TypeScriptSymbolExtractor;

	const coordinator = new IndexCoordinator(
		registry,
		metadataStore,
		backend,
		symbolExtractor,
		new FileSymbolIndexStore(tempRoot),
	);

	const submitted = await coordinator.submitRefresh("sample");
	assert.equal(submitted.state, "indexing");
	assert.equal(submitted.serviceTier, "unavailable");

	const refreshPromise = coordinator.refreshRepository("sample");
	await waitForCondition(() => {
		const status = statuses.get("sample");
		return status?.state === "ready" && status.symbolState === "indexing";
	});

	const lexicalReady = await coordinator.ensureLexicalReady("sample");
	assert.equal(lexicalReady.state, "ready");
	assert.equal(lexicalReady.symbolState, "indexing");
	assert.equal(lexicalReady.serviceTier, "lexical-only");
	assert.equal(statuses.get("sample")?.jobPhase, "building_symbols");

	deferredSymbols.resolve([]);
	const finalStatus = await refreshPromise;
	assert.equal(finalStatus.state, "ready");
	assert.equal(finalStatus.symbolState, "ready");
	assert.equal(finalStatus.serviceTier, "full");
});

test("IndexCoordinator can skip symbol extraction when disabled by configuration", async (t) => {
	const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codeatlas-lifecycle-nosymbol-"));
	t.after(async () => {
		await rm(tempRoot, { recursive: true, force: true });
	});

	const repositoryRoot = path.join(tempRoot, "repo");
	await mkdir(repositoryRoot, { recursive: true });
	await writeFile(path.join(repositoryRoot, "index.ts"), "export const value = 1;\n", "utf8");

	const repository = {
		name: "sample",
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
	const metadataStore = {
		async listIndexStatuses() {
			return [...statuses.values()];
		},
		async getIndexStatus(repo: string) {
			return statuses.get(repo) ?? null;
		},
		async setIndexStatus(status: RepositoryIndexStatus) {
			statuses.set(status.repo, status);
		},
	};
	let extracted = false;
	const backend: LexicalSearchBackend = {
		kind: "mock",
		async prepareRepository() {
			return {
				repo: repository.name,
				backend: "mock",
				state: "ready",
				lastIndexedAt: new Date().toISOString(),
			};
		},
		async searchRepository() {
			return [];
		},
	};
	const symbolExtractor = {
		async extractRepository() {
			extracted = true;
			return [];
		},
	} as unknown as TypeScriptSymbolExtractor;

	const coordinator = new IndexCoordinator(
		registry,
		metadataStore,
		backend,
		symbolExtractor,
		new FileSymbolIndexStore(tempRoot),
		{ enableSymbolExtraction: false },
	);

	const finalStatus = await coordinator.refreshRepository("sample");

	assert.equal(extracted, false);
	assert.equal(finalStatus.state, "ready");
	assert.equal(finalStatus.symbolState, "not_indexed");
	assert.equal(finalStatus.serviceTier, "lexical-only");
	assert.match(finalStatus.detail ?? "", /disabled by configuration/i);
});