import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	defaultConfig,
	loadConfig,
} from "../../packages/core/src/configuration/config.js";

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
	assert.deepEqual(config.debug, { level: "info", scopes: [], trace: false });
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
	assert.deepEqual(config.debug, { level: "info", scopes: [], trace: false, file: undefined });
});

test("defaultConfig keeps debug logging opt-in", () => {
	const config = defaultConfig();
	assert.equal(config.debug.scopes.length, 0);
	assert.equal(config.debug.trace, false);
	assert.equal(config.debug.level, "info");
});

test("loadConfig reads debug.level from config file", async (t) => {
const tempDir = await mkdtemp(path.join(os.tmpdir(), "codeatlas-config-"));
t.after(async () => {
await rm(tempDir, { recursive: true, force: true });
});

const configPath = path.join(tempDir, "codeatlas.json");
await writeFile(
configPath,
JSON.stringify({
debug: {
level: "debug",
scopes: ["mcp"],
trace: false,
},
}),
"utf8",
);

const config = await loadConfig(configPath, tempDir);
assert.equal(config.debug.level, "debug");
assert.deepEqual(config.debug.scopes, ["mcp"]);
});

test("loadConfig resolves debug.file relative to config dir", async (t) => {
const tempDir = await mkdtemp(path.join(os.tmpdir(), "codeatlas-config-"));
t.after(async () => {
await rm(tempDir, { recursive: true, force: true });
});

const configPath = path.join(tempDir, "codeatlas.json");
await writeFile(
configPath,
JSON.stringify({
debug: {
level: "info",
file: "logs/codeatlas.log",
scopes: [],
trace: false,
},
}),
"utf8",
);

const config = await loadConfig(configPath, tempDir);
assert.equal(
config.debug.file,
path.resolve(tempDir, "logs/codeatlas.log"),
);
});

test("loadConfig leaves debug.file undefined when not specified", async (t) => {
const tempDir = await mkdtemp(path.join(os.tmpdir(), "codeatlas-config-"));
t.after(async () => {
await rm(tempDir, { recursive: true, force: true });
});

const configPath = path.join(tempDir, "codeatlas.json");
await writeFile(configPath, JSON.stringify({}), "utf8");

const config = await loadConfig(configPath, tempDir);
assert.equal(config.debug.file, undefined);
});
