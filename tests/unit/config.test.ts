import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../../packages/core/src/configuration/config.js";

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
