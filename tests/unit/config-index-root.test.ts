import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	defaultConfig,
	loadConfig,
} from "../../packages/core/src/configuration/config.js";

test("defaultConfig sets the documented top-level indexRoot default", () => {
	const config = defaultConfig("/base");
	assert.equal(config.indexRoot, path.resolve("/base", "data/indexes"));
});

test("loadConfig derives Zoekt indexRoot from top-level indexRoot when lexicalBackend.indexRoot is not set", async (t) => {
	const tempDir = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-config-derive-"),
	);
	t.after(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	const configPath = path.join(tempDir, "codeatlas.json");
	await writeFile(
		configPath,
		JSON.stringify({
			indexRoot: "./my-custom-indexes",
			lexicalBackend: {
				kind: "zoekt",
				zoektIndexExecutable: "zoekt-index",
				zoektSearchExecutable: "zoekt",
				// No indexRoot here — should derive from top-level
			},
		}),
		"utf8",
	);

	const config = await loadConfig(configPath, tempDir);

	assert.equal(config.lexicalBackend.kind, "zoekt");
	if (config.lexicalBackend.kind === "zoekt") {
		// Should contain the top-level indexRoot + "/zoekt"
		const expected = path.resolve(tempDir, "my-custom-indexes", "zoekt");
		assert.equal(config.lexicalBackend.indexRoot, expected);
	}
});

test("loadConfig uses explicit lexicalBackend.indexRoot when provided", async (t) => {
	const tempDir = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-config-explicit-"),
	);
	t.after(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	const configPath = path.join(tempDir, "codeatlas.json");
	await writeFile(
		configPath,
		JSON.stringify({
			indexRoot: "./my-custom-indexes",
			lexicalBackend: {
				kind: "zoekt",
				zoektIndexExecutable: "zoekt-index",
				zoektSearchExecutable: "zoekt",
				indexRoot: "./explicit-zoekt-path",
			},
		}),
		"utf8",
	);

	const config = await loadConfig(configPath, tempDir);

	assert.equal(config.lexicalBackend.kind, "zoekt");
	if (config.lexicalBackend.kind === "zoekt") {
		// Should use the explicit value, not the derived one
		const expected = path.resolve(tempDir, "explicit-zoekt-path");
		assert.equal(config.lexicalBackend.indexRoot, expected);
	}
});

test("loadConfig falls back to built-in default when neither indexRoot is set", async (t) => {
	const tempDir = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-config-default-"),
	);
	t.after(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	const configPath = path.join(tempDir, "codeatlas.json");
	await writeFile(
		configPath,
		JSON.stringify({
			lexicalBackend: {
				kind: "zoekt",
				zoektIndexExecutable: "zoekt-index",
				zoektSearchExecutable: "zoekt",
				// Neither top-level indexRoot nor lexicalBackend.indexRoot
			},
		}),
		"utf8",
	);

	const config = await loadConfig(configPath, tempDir);

	assert.equal(config.lexicalBackend.kind, "zoekt");
	if (config.lexicalBackend.kind === "zoekt") {
		// Should contain "zoekt" at the end since it derives from the default indexRoot
		assert.ok(
			config.lexicalBackend.indexRoot.endsWith("zoekt"),
			`Expected path to end with 'zoekt', got: ${config.lexicalBackend.indexRoot}`,
		);
	}
});
