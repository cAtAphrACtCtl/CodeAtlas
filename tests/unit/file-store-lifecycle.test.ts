import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { FileMetadataStore } from "../../src/core/metadata/file-metadata-store.js";
import { FileRepositoryRegistry } from "../../src/core/registry/file-repository-registry.js";
import { FileSymbolIndexStore } from "../../src/core/search/symbol-index-store.js";

test("file-backed stores support unregister, metadata delete, and isolated symbol cleanup", async (t) => {
	const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codeatlas-file-store-"));
	t.after(async () => {
		await rm(tempRoot, { recursive: true, force: true });
	});

	const repoRoot = path.join(tempRoot, "repo");
	await mkdir(repoRoot, { recursive: true });
	const registry = new FileRepositoryRegistry(path.join(tempRoot, "registry.json"));
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