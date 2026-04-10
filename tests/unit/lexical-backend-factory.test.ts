import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	getRepoArtifactDir,
	getRepoBuildDir,
	getRepoIndexDir,
} from "../../src/core/indexer/repo-artifact-path.js";
import { createLexicalSearchBackend } from "../../src/core/search/create-lexical-search-backend.js";
import { BootstrapRipgrepLexicalSearchBackend } from "../../src/core/search/ripgrep-lexical-search-backend.js";
import { ZoektLexicalSearchBackend } from "../../src/core/search/zoekt-lexical-search-backend.js";

test("createLexicalSearchBackend returns the bootstrap ripgrep backend for ripgrep config", () => {
	const backend = createLexicalSearchBackend(
		{
			kind: "ripgrep",
			executable: "rg",
			fallbackToNaiveScan: true,
		},
		256 * 1024,
	);

	assert.ok(backend instanceof BootstrapRipgrepLexicalSearchBackend);
	assert.equal(backend.kind, "ripgrep");
});

test("createLexicalSearchBackend returns the Zoekt backend for zoekt config", () => {
	const backend = createLexicalSearchBackend(
		{
			kind: "zoekt",
			zoektIndexExecutable: "zoekt-index",
			zoektSearchExecutable: "zoekt-search",
			indexRoot: "C:/indexes/zoekt",
			allowBootstrapFallback: true,
			bootstrapFallback: {
				kind: "ripgrep",
				executable: "rg",
				fallbackToNaiveScan: true,
			},
		},
		256 * 1024,
	);

	assert.ok(backend instanceof ZoektLexicalSearchBackend);
	assert.equal(backend.kind, "zoekt");
});

test("ZoektLexicalSearchBackend uses separate timeouts for availability checks and index builds", async (t) => {
	const repositoryRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-zoekt-timeout-split-"),
	);
	t.after(async () => {
		await rm(repositoryRoot, { recursive: true, force: true });
	});
	await mkdir(path.join(repositoryRoot, "src"), { recursive: true });

	const calls: Array<{ args: string[]; timeout: number | undefined }> = [];
	const backend = new ZoektLexicalSearchBackend(
		{
			kind: "zoekt",
			zoektIndexExecutable: "zoekt-index",
			zoektSearchExecutable: "zoekt-search",
			indexRoot: path.join(repositoryRoot, "indexes"),
			allowBootstrapFallback: false,
			bootstrapFallback: {
				kind: "ripgrep",
				executable: "rg",
				fallbackToNaiveScan: true,
			},
		},
		undefined,
		{
			availabilityTimeoutMs: 5,
			indexBuildTimeoutMs: 50,
			execFile: async (_file, args, options) => {
				calls.push({ args, timeout: options.timeout });
				if (args[0] === "-file_limit") {
					const buildDir = args[5];
					await writeFile(path.join(buildDir, "repo.zoekt"), "placeholder", "utf8");
				}
				return { stdout: "", stderr: "" };
			},
		},
	);

	const status = await backend.prepareRepository({
		name: "sample",
		rootPath: repositoryRoot,
		registeredAt: new Date().toISOString(),
	});

	assert.equal(status.state, "ready");
	assert.equal(status.backend, "zoekt");
	assert.deepEqual(
		calls.map((call) => ({ command: call.args[0], timeout: call.timeout })),
		[
			{ command: "-help", timeout: 5 },
			{ command: "-help", timeout: 5 },
			{ command: "-file_limit", timeout: 50 },
		],
	);
	assert.deepEqual(calls[2]?.args.slice(0, 4), [
		"-file_limit",
		String(256 * 1024),
		"-ignore_dirs",
		".git,bin,obj,publish,node_modules,dist,data,.next",
	]);
	const activeDir = getRepoIndexDir(
		path.join(repositoryRoot, "indexes"),
		"sample",
		repositoryRoot,
	);
	const stagingDir = getRepoBuildDir(
		path.join(repositoryRoot, "indexes"),
		"sample",
		repositoryRoot,
	);
	assert.equal(path.basename(activeDir), "active");
	assert.equal(path.basename(stagingDir), "staging");
});

test("ZoektLexicalSearchBackend promotes staged build output into the active index directory", async (t) => {
	const repositoryRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-zoekt-promote-"),
	);
	const indexRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-zoekt-promote-index-"),
	);
	t.after(async () => {
		await rm(repositoryRoot, { recursive: true, force: true });
		await rm(indexRoot, { recursive: true, force: true });
	});
	await mkdir(path.join(repositoryRoot, "src"), { recursive: true });

	const backend = new ZoektLexicalSearchBackend(
		{
			kind: "zoekt",
			zoektIndexExecutable: "zoekt-index",
			zoektSearchExecutable: "zoekt-search",
			indexRoot,
			allowBootstrapFallback: false,
			bootstrapFallback: {
				kind: "ripgrep",
				executable: "rg",
				fallbackToNaiveScan: true,
			},
		},
		undefined,
		{
			execFile: async (_file, args) => {
				if (args[0] === "-file_limit") {
					const buildDir = args[5];
					await writeFile(path.join(buildDir, "repo.zoekt"), "placeholder", "utf8");
				}
				return { stdout: "", stderr: "" };
			},
		},
	);

	const status = await backend.prepareRepository({
		name: "sample",
		rootPath: repositoryRoot,
		registeredAt: new Date().toISOString(),
	});

	const activeDir = getRepoIndexDir(indexRoot, "sample", repositoryRoot);
	const stagingDir = getRepoBuildDir(indexRoot, "sample", repositoryRoot);
	const artifactDir = getRepoArtifactDir(indexRoot, "sample", repositoryRoot);
	const artifactEntries = await readdir(artifactDir, { withFileTypes: true });

	assert.equal(status.state, "ready");
	assert.match(status.detail ?? "", /active/);
	assert.equal(artifactEntries.some((entry) => entry.name === "active"), true);
	assert.equal(artifactEntries.some((entry) => entry.name === "staging"), false);
	assert.equal(artifactEntries.some((entry) => entry.name === "previous"), false);
	assert.equal((await readdir(activeDir)).includes("repo.zoekt"), true);
	await assert.rejects(() => readdir(stagingDir));
});

test("ZoektLexicalSearchBackend preserves the active index when a rebuild fails", async (t) => {
	const repositoryRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-zoekt-preserve-active-"),
	);
	const indexRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-zoekt-preserve-active-index-"),
	);
	t.after(async () => {
		await rm(repositoryRoot, { recursive: true, force: true });
		await rm(indexRoot, { recursive: true, force: true });
	});
	await mkdir(path.join(repositoryRoot, "src"), { recursive: true });

	const activeDir = getRepoIndexDir(indexRoot, "sample", repositoryRoot);
	await mkdir(activeDir, { recursive: true });
	await writeFile(path.join(activeDir, "repo.zoekt"), "active-shard", "utf8");

	const backend = new ZoektLexicalSearchBackend(
		{
			kind: "zoekt",
			zoektIndexExecutable: "zoekt-index",
			zoektSearchExecutable: "zoekt-search",
			indexRoot,
			allowBootstrapFallback: false,
			bootstrapFallback: {
				kind: "ripgrep",
				executable: "rg",
				fallbackToNaiveScan: true,
			},
		},
		undefined,
		{
			execFile: async (_file, args) => {
				if (args[0] === "-file_limit") {
					throw new Error("simulated build failure");
				}

				return { stdout: "", stderr: "" };
			},
		},
	);

	const status = await backend.prepareRepository({
		name: "sample",
		rootPath: repositoryRoot,
		registeredAt: new Date().toISOString(),
	});

	assert.equal(status.state, "error");
	assert.equal((await readdir(activeDir)).includes("repo.zoekt"), true);
	assert.equal(
		await readFile(path.join(activeDir, "repo.zoekt"), "utf8"),
		"active-shard",
	);
});

test("ZoektLexicalSearchBackend verifyRepositoryReady inspects only the active index directory", async (t) => {
	const repositoryRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-zoekt-active-ready-"),
	);
	const indexRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-zoekt-active-ready-index-"),
	);
	t.after(async () => {
		await rm(repositoryRoot, { recursive: true, force: true });
		await rm(indexRoot, { recursive: true, force: true });
	});

	const stagingDir = getRepoBuildDir(indexRoot, "sample", repositoryRoot);
	await mkdir(stagingDir, { recursive: true });
	await writeFile(path.join(stagingDir, "repo.zoekt"), "staging-shard", "utf8");

	const backend = new ZoektLexicalSearchBackend(
		{
			kind: "zoekt",
			zoektIndexExecutable: "zoekt-index",
			zoektSearchExecutable: "zoekt-search",
			indexRoot,
			allowBootstrapFallback: false,
			bootstrapFallback: {
				kind: "ripgrep",
				executable: "rg",
				fallbackToNaiveScan: true,
			},
		},
		undefined,
		{
			execFile: async () => ({ stdout: "", stderr: "" }),
		},
	);

	const ready = await backend.verifyRepositoryReady(
		{
			name: "sample",
			rootPath: repositoryRoot,
			registeredAt: new Date().toISOString(),
		},
		{
			repo: "sample",
			backend: "zoekt",
			configuredBackend: "zoekt",
			state: "ready",
			symbolState: "ready",
			lastIndexedAt: new Date().toISOString(),
			symbolLastIndexedAt: new Date().toISOString(),
		},
	);

	assert.deepEqual(ready, {
		ready: false,
		state: "stale",
		reason: "zoekt_index_missing",
		detail: `Zoekt index directory is missing for repository sample: ${getRepoIndexDir(indexRoot, "sample", repositoryRoot)}`,
	});
});

test("ZoektLexicalSearchBackend deleteRepositoryArtifacts removes the full repo artifact root", async (t) => {
	const repositoryRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-zoekt-delete-"),
	);
	const indexRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-zoekt-delete-index-"),
	);
	t.after(async () => {
		await rm(repositoryRoot, { recursive: true, force: true });
		await rm(indexRoot, { recursive: true, force: true });
	});

	const activeDir = getRepoIndexDir(indexRoot, "sample", repositoryRoot);
	const stagingDir = getRepoBuildDir(indexRoot, "sample", repositoryRoot);
	await mkdir(activeDir, { recursive: true });
	await mkdir(stagingDir, { recursive: true });
	await writeFile(path.join(activeDir, "repo.zoekt"), "active", "utf8");
	await writeFile(path.join(stagingDir, "repo.zoekt"), "staging", "utf8");

	const backend = new ZoektLexicalSearchBackend({
		kind: "zoekt",
		zoektIndexExecutable: "zoekt-index",
		zoektSearchExecutable: "zoekt-search",
		indexRoot,
		allowBootstrapFallback: false,
		bootstrapFallback: {
			kind: "ripgrep",
			executable: "rg",
			fallbackToNaiveScan: true,
		},
	});

	await backend.deleteRepositoryArtifacts({
		name: "sample",
		rootPath: repositoryRoot,
		registeredAt: new Date().toISOString(),
	});

	await assert.rejects(() => readdir(getRepoArtifactDir(indexRoot, "sample", repositoryRoot)));
});

test("ZoektLexicalSearchBackend uses a dedicated timeout for search after availability succeeds", async (t) => {
	const repositoryRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-zoekt-search-timeout-"),
	);
	const indexRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-zoekt-search-index-"),
	);
	t.after(async () => {
		await rm(repositoryRoot, { recursive: true, force: true });
		await rm(indexRoot, { recursive: true, force: true });
	});
	const indexDir = getRepoIndexDir(indexRoot, "sample", repositoryRoot);
	await mkdir(indexDir, { recursive: true });
	await writeFile(path.join(indexDir, "repo.zoekt"), "placeholder", "utf8");

	const calls: Array<{ args: string[]; timeout: number | undefined }> = [];
	const backend = new ZoektLexicalSearchBackend(
		{
			kind: "zoekt",
			zoektIndexExecutable: "zoekt-index",
			zoektSearchExecutable: "zoekt-search",
			indexRoot,
			allowBootstrapFallback: false,
			bootstrapFallback: {
				kind: "ripgrep",
				executable: "rg",
				fallbackToNaiveScan: true,
			},
		},
		undefined,
		{
			availabilityTimeoutMs: 7,
			searchTimeoutMs: 45,
			execFile: async (_file, args, options) => {
				calls.push({ args, timeout: options.timeout });
				if (args[0] === "-index_dir") {
					return {
						stdout: "src/example.ts:4:buildAtlas()\n",
						stderr: "",
					};
				}

				return { stdout: "", stderr: "" };
			},
		},
	);

	const hits = await backend.searchRepository(
		{
			name: "sample",
			rootPath: repositoryRoot,
			registeredAt: new Date().toISOString(),
		},
		{
			query: "buildAtlas",
			limit: 5,
		},
	);

	assert.equal(hits.length, 1);
	assert.equal(hits[0]?.path, "src/example.ts");
	assert.deepEqual(
		calls.map((call) => ({ command: call.args[0], timeout: call.timeout })),
		[
			{ command: "-help", timeout: 7 },
			{ command: "-help", timeout: 7 },
			{ command: "-index_dir", timeout: 45 },
		],
	);
});

test("ZoektLexicalSearchBackend normalizes absolute search hit paths to repository-relative paths", async (t) => {
	const repositoryRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-zoekt-search-paths-"),
	);
	const indexRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-zoekt-search-paths-index-"),
	);
	t.after(async () => {
		await rm(repositoryRoot, { recursive: true, force: true });
		await rm(indexRoot, { recursive: true, force: true });
	});
	const indexDir = getRepoIndexDir(indexRoot, "sample", repositoryRoot);
	await mkdir(indexDir, { recursive: true });
	await writeFile(path.join(indexDir, "repo.zoekt"), "placeholder", "utf8");
	const calls: Array<{ args: string[]; timeout: number | undefined }> = [];
	const backend = new ZoektLexicalSearchBackend(
		{
			kind: "zoekt",
			zoektIndexExecutable: "zoekt-index",
			zoektSearchExecutable: "zoekt-search",
			indexRoot,
			allowBootstrapFallback: false,
			bootstrapFallback: {
				kind: "ripgrep",
				executable: "rg",
				fallbackToNaiveScan: true,
			},
		},
		undefined,
		{
			availabilityTimeoutMs: 7,
			searchTimeoutMs: 45,
			execFile: async (_file, args, options) => {
				calls.push({ args, timeout: options.timeout });
				if (args[0] === "-index_dir") {
					return {
						stdout: `${path.join(repositoryRoot, "src", "absolute-example.ts")}:4:buildAtlas()\n`,
						stderr: "",
					};
				}

				return { stdout: "", stderr: "" };
			},
		},
	);

	const hits = await backend.searchRepository(
		{
			name: "sample",
			rootPath: repositoryRoot,
			registeredAt: new Date().toISOString(),
		},
		{
			query: "buildAtlas",
			limit: 5,
		},
	);

	assert.equal(hits.length, 1);
	assert.equal(hits[0]?.path, "src/absolute-example.ts");
	assert.deepEqual(
		calls.map((call) => ({ command: call.args[0], timeout: call.timeout })),
		[
			{ command: "-help", timeout: 7 },
			{ command: "-help", timeout: 7 },
			{ command: "-index_dir", timeout: 45 },
		],
	);
});

test("ZoektLexicalSearchBackend falls back to bootstrap prepareRepository when executables are unavailable", async (t) => {
	const repositoryRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-zoekt-fallback-"),
	);
	t.after(async () => {
		await rm(repositoryRoot, { recursive: true, force: true });
	});
	await mkdir(path.join(repositoryRoot, "src"), { recursive: true });

	const backend = new ZoektLexicalSearchBackend(
		{
			kind: "zoekt",
			zoektIndexExecutable: "missing-zoekt-index",
			zoektSearchExecutable: "missing-zoekt-search",
			indexRoot: path.join(repositoryRoot, "indexes"),
			allowBootstrapFallback: true,
			bootstrapFallback: {
				kind: "ripgrep",
				executable: "rg",
				fallbackToNaiveScan: true,
			},
		},
		{
			kind: "ripgrep",
			async prepareRepository(repository) {
				return {
					repo: repository.name,
					backend: "ripgrep",
					state: "ready",
					detail: "fallback ready",
				};
			},
			async searchRepository() {
				return [];
			},
		},
	);

	const status = await backend.prepareRepository({
		name: "sample",
		rootPath: repositoryRoot,
		registeredAt: new Date().toISOString(),
	});

	assert.equal(status.state, "ready");
	assert.equal(status.backend, "ripgrep");
	assert.match(status.detail ?? "", /Zoekt index executable not available/);
	assert.match(status.detail ?? "", /fallback ready/);
});

test("ZoektLexicalSearchBackend returns an error when executables are unavailable and fallback is disabled", async (t) => {
	const repositoryRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-zoekt-error-"),
	);
	t.after(async () => {
		await rm(repositoryRoot, { recursive: true, force: true });
	});
	await mkdir(path.join(repositoryRoot, "src"), { recursive: true });

	const backend = new ZoektLexicalSearchBackend({
		kind: "zoekt",
		zoektIndexExecutable: "missing-zoekt-index",
		zoektSearchExecutable: "missing-zoekt-search",
		indexRoot: path.join(repositoryRoot, "indexes"),
		allowBootstrapFallback: false,
		bootstrapFallback: {
			kind: "ripgrep",
			executable: "rg",
			fallbackToNaiveScan: true,
		},
	});

	const status = await backend.prepareRepository({
		name: "sample",
		rootPath: repositoryRoot,
		registeredAt: new Date().toISOString(),
	});

	assert.equal(status.state, "error");
	assert.equal(status.backend, "zoekt");
	assert.match(status.detail ?? "", /Zoekt index executable not available/);
});

test("ZoektLexicalSearchBackend falls back to bootstrap searchRepository when executables are unavailable", async () => {
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
			async prepareRepository() {
				throw new Error("not used");
			},
			async searchRepository() {
				return [
					{
						path: "src/example.ts",
						startLine: 4,
						endLine: 4,
						snippet: "buildAtlas()",
						score: 77,
					},
				];
			},
		},
	);

	const hits = await backend.searchRepository(
		{
			name: "sample",
			rootPath: process.cwd(),
			registeredAt: new Date().toISOString(),
		},
		{
			query: "buildAtlas",
			limit: 5,
		},
	);

	assert.equal(hits.length, 1);
	assert.equal(hits[0]?.path, "src/example.ts");
	assert.equal(hits[0]?.score, 77);
});

test("ZoektLexicalSearchBackend throws from searchRepository when executables are unavailable and fallback is disabled", async () => {
	const backend = new ZoektLexicalSearchBackend({
		kind: "zoekt",
		zoektIndexExecutable: "missing-zoekt-index",
		zoektSearchExecutable: "missing-zoekt-search",
		indexRoot: "C:/indexes/zoekt",
		allowBootstrapFallback: false,
		bootstrapFallback: {
			kind: "ripgrep",
			executable: "rg",
			fallbackToNaiveScan: true,
		},
	});

	await assert.rejects(
		() =>
			backend.searchRepository(
				{
					name: "sample",
					rootPath: process.cwd(),
					registeredAt: new Date().toISOString(),
				},
				{
					query: "buildAtlas",
					limit: 5,
				},
			),
		/Zoekt index executable not available/,
	);
});

