import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getRepoIndexDir } from "../../src/core/indexer/repo-artifact-path.js";
import { FileMetadataStore } from "../../src/core/metadata/file-metadata-store.js";
import { FileRepositoryRegistry } from "../../src/core/registry/file-repository-registry.js";
import { getSymbolIndexPath } from "../../src/core/search/symbol-index-store.js";
import { FileSymbolIndexStore } from "../../src/core/search/symbol-index-store.js";

test("file-backed stores support unregister, metadata delete, and isolated symbol cleanup", async (t) => {
	const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codeatlas-file-store-"));
	t.after(async () => {
		await rm(tempRoot, { recursive: true, force: true });
	});

	const repoRoot = path.join(tempRoot, "repo");
	await mkdir(repoRoot, { recursive: true });
	const registry = new FileRepositoryRegistry(path.join(tempRoot, "registry.json"), {
		lexicalIndexRoot: path.join(tempRoot, "zoekt"),
		symbolIndexRoot: tempRoot,
	});
	const metadataStore = new FileMetadataStore(path.join(tempRoot, "metadata.json"));
	const symbolStore = new FileSymbolIndexStore(tempRoot);

	await registry.registerRepository({
		name: "codeatlas",
		rootPath: repoRoot,
	});
	await registry.registerRepository({
		name: "CodeAtlas",
		rootPath: repoRoot,
	});

	await metadataStore.setIndexStatus({
		repo: "codeatlas",
		backend: "zoekt",
		state: "ready",
		symbolState: "ready",
	});
	await symbolStore.setSymbols("codeatlas", []);
	await symbolStore.setSymbols("CodeAtlas", [
		{
			repo: "CodeAtlas",
			path: "src/main.ts",
			name: "main",
			kind: "function",
			start_line: 1,
			end_line: 1,
		},
	]);

	const removedRepository = await registry.unregisterRepository?.("codeatlas");
	const removedStatus = await metadataStore.deleteIndexStatus?.("codeatlas");
	await symbolStore.deleteSymbols?.("codeatlas");

	assert.equal(removedRepository?.name, "codeatlas");
	assert.equal(removedStatus?.repo, "codeatlas");
	assert.equal(await registry.getRepository("codeatlas"), null);
	assert.equal(await metadataStore.getIndexStatus("codeatlas"), null);
	const remainingRepository = await registry.getRepository("CodeAtlas");
	assert.equal(
		remainingRepository?.lexicalIndexPath,
		getRepoIndexDir(path.join(tempRoot, "zoekt"), "CodeAtlas", repoRoot),
	);
	assert.equal(
		remainingRepository?.symbolIndexPath,
		getSymbolIndexPath(tempRoot, "CodeAtlas"),
	);
	assert.deepEqual(await symbolStore.getSymbols("CodeAtlas"), [
		{
			repo: "CodeAtlas",
			path: "src/main.ts",
			name: "main",
			kind: "function",
			start_line: 1,
			end_line: 1,
		},
	]);
});

test("file-backed registry backfills derived index paths for legacy repository records", async (t) => {
	const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codeatlas-registry-backfill-"));
	t.after(async () => {
		await rm(tempRoot, { recursive: true, force: true });
	});

	const repoRoot = path.join(tempRoot, "repo");
	const registryPath = path.join(tempRoot, "registry.json");
	await mkdir(repoRoot, { recursive: true });
	await writeFile(
		registryPath,
		JSON.stringify(
			{
				repositories: [
					{
						name: "sample",
						rootPath: repoRoot,
						registeredAt: "2026-04-02T00:00:00.000Z",
					},
				],
			},
			null,
			2,
		),
		"utf8",
	);

	const registry = new FileRepositoryRegistry(registryPath, {
		lexicalIndexRoot: path.join(tempRoot, "zoekt"),
		symbolIndexRoot: tempRoot,
	});
	const repositories = await registry.listRepositories();
	const storedDocument = JSON.parse(await readFile(registryPath, "utf8")) as {
		repositories: Array<{
			name: string;
			lexicalIndexPath?: string;
			symbolIndexPath?: string;
		}>;
	};

	assert.equal(repositories[0]?.lexicalIndexPath,
		getRepoIndexDir(path.join(tempRoot, "zoekt"), "sample", repoRoot),
	);
	assert.equal(repositories[0]?.symbolIndexPath, getSymbolIndexPath(tempRoot, "sample"));
	assert.equal(
		storedDocument.repositories[0]?.lexicalIndexPath,
		getRepoIndexDir(path.join(tempRoot, "zoekt"), "sample", repoRoot),
	);
	assert.equal(
		storedDocument.repositories[0]?.symbolIndexPath,
		getSymbolIndexPath(tempRoot, "sample"),
	);
});