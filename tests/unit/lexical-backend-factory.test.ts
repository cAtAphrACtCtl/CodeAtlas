import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLexicalSearchBackend } from "../../packages/core/src/search/create-lexical-search-backend.js";
import { BootstrapRipgrepLexicalSearchBackend } from "../../packages/core/src/search/ripgrep-lexical-search-backend.js";
import { ZoektLexicalSearchBackend } from "../../packages/core/src/search/zoekt-lexical-search-backend.js";

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
			{ command: "-index", timeout: 50 },
		],
	);
});

test("ZoektLexicalSearchBackend uses a dedicated timeout for search after availability succeeds", async () => {
	const calls: Array<{ args: string[]; timeout: number | undefined }> = [];
	const backend = new ZoektLexicalSearchBackend(
		{
			kind: "zoekt",
			zoektIndexExecutable: "zoekt-index",
			zoektSearchExecutable: "zoekt-search",
			indexRoot: "C:/indexes/zoekt",
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
