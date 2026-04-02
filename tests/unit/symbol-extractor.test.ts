import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { TypeScriptSymbolExtractor } from "../../src/core/search/symbol-extractor.js";

test("TypeScriptSymbolExtractor returns accurate line ranges for nested symbols", async (t) => {
	const repositoryRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-symbol-extractor-"),
	);
	t.after(async () => {
		await rm(repositoryRoot, { recursive: true, force: true });
	});
	await mkdir(path.join(repositoryRoot, "src"), { recursive: true });
	await writeFile(
		path.join(repositoryRoot, "src", "feature.ts"),
		[
			"export class AtlasBuilder {",
			"  buildAtlas() {",
			"    return true;",
			"  }",
			"}",
		].join("\n"),
		"utf8",
	);

	const extractor = new TypeScriptSymbolExtractor();
	const symbols = await extractor.extractRepository({
		name: "sample",
		rootPath: repositoryRoot,
		registeredAt: new Date().toISOString(),
	});

	const atlasBuilder = symbols.find((symbol) => symbol.name === "AtlasBuilder");
	const buildAtlas = symbols.find((symbol) => symbol.name === "buildAtlas");

	assert.ok(atlasBuilder);
	assert.equal(atlasBuilder?.start_line, 1);
	assert.equal(atlasBuilder?.end_line, 5);
	assert.ok(buildAtlas);
	assert.equal(buildAtlas?.start_line, 2);
	assert.equal(buildAtlas?.end_line, 4);
	assert.equal(buildAtlas?.container_name, "AtlasBuilder");
});

test("TypeScriptSymbolExtractor respects configured concurrency", async () => {
	const extractor = new TypeScriptSymbolExtractor({ concurrency: 2 }) as any;
	let active = 0;
	let maxActive = 0;

	extractor.walkRepository = async () => [
		"a.ts",
		"b.ts",
		"c.ts",
		"d.ts",
		"e.ts",
	];
	extractor.extractFile = async () => {
		active += 1;
		maxActive = Math.max(maxActive, active);
		await new Promise((resolve) => setTimeout(resolve, 10));
		active -= 1;
		return [];
	};

	await extractor.extractRepository({
		name: "sample",
		rootPath: "C:/repos/sample",
		registeredAt: new Date().toISOString(),
	});

	assert.equal(maxActive, 2);
});

test("TypeScriptSymbolExtractor skips build artifact directories", async (t) => {
	const repositoryRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-symbol-extractor-skip-"),
	);
	t.after(async () => {
		await rm(repositoryRoot, { recursive: true, force: true });
	});

	await mkdir(path.join(repositoryRoot, "src"), { recursive: true });
	await mkdir(path.join(repositoryRoot, "bin"), { recursive: true });
	await mkdir(path.join(repositoryRoot, "publish"), { recursive: true });
	await writeFile(
		path.join(repositoryRoot, "src", "feature.ts"),
		"export function keepMe() { return true; }\n",
		"utf8",
	);
	await writeFile(
		path.join(repositoryRoot, "bin", "generated.ts"),
		"export function skipBin() { return true; }\n",
		"utf8",
	);
	await writeFile(
		path.join(repositoryRoot, "publish", "bundle.js"),
		"export function skipPublish() { return true; }\n",
		"utf8",
	);

	const extractor = new TypeScriptSymbolExtractor();
	const symbols = await extractor.extractRepository({
		name: "sample",
		rootPath: repositoryRoot,
		registeredAt: new Date().toISOString(),
	});

	assert.ok(symbols.some((symbol) => symbol.name === "keepMe"));
	assert.equal(symbols.some((symbol) => symbol.name === "skipBin"), false);
	assert.equal(symbols.some((symbol) => symbol.name === "skipPublish"), false);
});

