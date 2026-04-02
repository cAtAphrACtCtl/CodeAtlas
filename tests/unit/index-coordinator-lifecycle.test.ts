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