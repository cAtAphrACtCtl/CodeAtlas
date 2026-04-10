import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	defaultConfig,
	loadConfig,
} from "../../src/core/configuration/config.js";
import { ConfigurationService } from "../../src/core/configuration/configuration-service.js";

test("loadConfig rejects empty executable paths", async (t) => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "codeatlas-config-"));
	t.after(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	const configPath = path.join(tempDir, "codeatlas.json");
	await writeFile(
		configPath,
		JSON.stringify({
			lexicalBackend: {
				kind: "zoekt",
				zoektIndexExecutable: "",
				zoektSearchExecutable: "zoekt",
			},
		}),
		"utf8",
	);

	await assert.rejects(
		() => loadConfig(configPath, tempDir),
		/Executable path cannot be empty/,
	);
});

test("loadConfig rejects whitespace-only executable paths", async (t) => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "codeatlas-config-"));
	t.after(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	const configPath = path.join(tempDir, "codeatlas.json");
	await writeFile(
		configPath,
		JSON.stringify({
			lexicalBackend: {
				kind: "ripgrep",
				executable: "   ",
			},
		}),
		"utf8",
	);

	await assert.rejects(
		() => loadConfig(configPath, tempDir),
		/Executable path cannot be empty/,
	);
});

test("defaultConfig includes debug section with empty scopes", () => {
	const config = defaultConfig();
	assert.deepEqual(config.debug, { scopes: [], trace: false });
});

test("loadConfig merges debug settings from config file", async (t) => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "codeatlas-config-"));
	t.after(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	const configPath = path.join(tempDir, "codeatlas.json");
	await writeFile(
		configPath,
		JSON.stringify({
			debug: {
				scopes: ["runtime", "mcp"],
				trace: true,
			},
		}),
		"utf8",
	);

	const config = await loadConfig(configPath, tempDir);
	assert.deepEqual(config.debug.scopes, ["runtime", "mcp"]);
	assert.equal(config.debug.trace, true);
});

test("loadConfig uses default debug settings when not specified", async (t) => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "codeatlas-config-"));
	t.after(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	const configPath = path.join(tempDir, "codeatlas.json");
	await writeFile(configPath, JSON.stringify({}), "utf8");

	const config = await loadConfig(configPath, tempDir);
	assert.deepEqual(config.debug, { scopes: [], trace: false });
});

test("defaultConfig keeps legacy debug compatibility opt-in", () => {
	const config = defaultConfig();
	assert.equal(config.debug.scopes.length, 0);
	assert.equal(config.debug.trace, false);
});

test("ConfigurationService prefers the Windows example config on win32", async (t) => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "codeatlas-config-service-"));
	t.after(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	const configDir = path.join(tempDir, "config");
	await mkdir(configDir, { recursive: true });
	await writeFile(path.join(configDir, "codeatlas.example.json"), "{}", "utf8");
	await writeFile(
		path.join(configDir, "codeatlas.windows.example.json"),
		"{}",
		"utf8",
	);

	const service = new ConfigurationService(tempDir, "win32");
	assert.equal(
		service.getDefaultConfigPath(),
		path.join(configDir, "codeatlas.windows.example.json"),
	);
});

test("ConfigurationService prefers the WSL or Linux example config on non-Windows runtimes", async (t) => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "codeatlas-config-service-"));
	t.after(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	const configDir = path.join(tempDir, "config");
	await mkdir(configDir, { recursive: true });
	await writeFile(path.join(configDir, "codeatlas.example.json"), "{}", "utf8");
	await writeFile(
		path.join(configDir, "codeatlas.wsl.example.json"),
		"{}",
		"utf8",
	);

	const service = new ConfigurationService(tempDir, "linux");
	assert.equal(
		service.getDefaultConfigPath(),
		path.join(configDir, "codeatlas.wsl.example.json"),
	);
});

test("defaultConfig includes indexing section with defaults", () => {
	const config = defaultConfig();
	assert.deepEqual(config.indexing, {
		indexBuildTimeoutMs: 120_000,
		symbolConcurrency: 0,
		enableSymbolExtraction: true,
	});
});

test("loadConfig merges indexing settings from config file", async (t) => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "codeatlas-config-"));
	t.after(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	const configPath = path.join(tempDir, "codeatlas.json");
	await writeFile(
		configPath,
		JSON.stringify({
			indexing: {
				indexBuildTimeoutMs: 1800000,
				symbolConcurrency: 4,
				enableSymbolExtraction: false,
			},
		}),
		"utf8",
	);

	const config = await loadConfig(configPath, tempDir);
	assert.equal(config.indexing.indexBuildTimeoutMs, 1800000);
	assert.equal(config.indexing.symbolConcurrency, 4);
	assert.equal(config.indexing.enableSymbolExtraction, false);
});

test("loadConfig uses default indexing settings when not specified", async (t) => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "codeatlas-config-"));
	t.after(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	const configPath = path.join(tempDir, "codeatlas.json");
	await writeFile(configPath, JSON.stringify({}), "utf8");

	const config = await loadConfig(configPath, tempDir);
	assert.equal(config.indexing.indexBuildTimeoutMs, 120_000);
	assert.equal(config.indexing.symbolConcurrency, 0);
	assert.equal(config.indexing.enableSymbolExtraction, true);
});

test("loadConfig allows partial indexing override", async (t) => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "codeatlas-config-"));
	t.after(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	const configPath = path.join(tempDir, "codeatlas.json");
	await writeFile(
		configPath,
		JSON.stringify({
			indexing: { indexBuildTimeoutMs: 600000 },
		}),
		"utf8",
	);

	const config = await loadConfig(configPath, tempDir);
	assert.equal(config.indexing.indexBuildTimeoutMs, 600000);
	assert.equal(config.indexing.symbolConcurrency, 0);
	assert.equal(config.indexing.enableSymbolExtraction, true);
});

