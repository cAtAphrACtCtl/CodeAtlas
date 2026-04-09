import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { BootstrapRipgrepLexicalSearchBackend } from "../../src/core/search/ripgrep-lexical-search-backend.js";

const maxBytesPerFile = 256 * 1024;
const boundaryQueries = [
	"root-hit",
	"hidden-hit",
	"artifact-alpha",
	"artifact-beta",
	"artifact-gamma",
	"node-hit",
	"dist-hit",
	"data-hit",
	"next-hit",
	"big-hit",
	"bin-hit",
];

function hasRipgrep(): boolean {
	const result = spawnSync("rg", ["--version"], {
		stdio: "ignore",
		windowsHide: true,
	});

	return !result.error && result.status === 0;
}

async function createBoundaryFixture(t: test.TestContext) {
	const repositoryRoot = await mkdtemp(
		path.join(os.tmpdir(), "codeatlas-rg-boundary-"),
	);
	t.after(async () => {
		await rm(repositoryRoot, { recursive: true, force: true });
	});

	await mkdir(path.join(repositoryRoot, "node_modules", "pkg"), {
		recursive: true,
	});
	await mkdir(path.join(repositoryRoot, "bin"), { recursive: true });
	await mkdir(path.join(repositoryRoot, "obj"), { recursive: true });
	await mkdir(path.join(repositoryRoot, "publish"), { recursive: true });
	await mkdir(path.join(repositoryRoot, "dist"), { recursive: true });
	await mkdir(path.join(repositoryRoot, "data"), { recursive: true });
	await mkdir(path.join(repositoryRoot, ".next"), { recursive: true });

	await writeFile(path.join(repositoryRoot, "main.txt"), "root-hit\n", "utf8");
	await writeFile(
		path.join(repositoryRoot, ".hidden.txt"),
		"hidden-hit\n",
		"utf8",
	);
	await writeFile(
		path.join(repositoryRoot, "bin", "generated.txt"),
		"artifact-alpha\n",
		"utf8",
	);
	await writeFile(
		path.join(repositoryRoot, "obj", "intermediate.txt"),
		"artifact-beta\n",
		"utf8",
	);
	await writeFile(
		path.join(repositoryRoot, "publish", "bundle.txt"),
		"artifact-gamma\n",
		"utf8",
	);
	await writeFile(
		path.join(repositoryRoot, "node_modules", "pkg", "index.js"),
		"node-hit\n",
		"utf8",
	);
	await writeFile(
		path.join(repositoryRoot, "dist", "output.txt"),
		"dist-hit\n",
		"utf8",
	);
	await writeFile(
		path.join(repositoryRoot, "data", "cache.txt"),
		"data-hit\n",
		"utf8",
	);
	await writeFile(
		path.join(repositoryRoot, ".next", "server.txt"),
		"next-hit\n",
		"utf8",
	);
	await writeFile(
		path.join(repositoryRoot, "big.txt"),
		`${"x".repeat(270_000)}\nbig-hit\n`,
		"utf8",
	);
	await writeFile(
		path.join(repositoryRoot, "binary.bin"),
		Buffer.from([0x62, 0x69, 0x6e, 0x2d, 0x68, 0x69, 0x74, 0x00]),
	);

	return {
		repository: {
			name: "sample",
			rootPath: repositoryRoot,
			registeredAt: new Date().toISOString(),
		},
	};
}

async function collectSearches(
	backend: BootstrapRipgrepLexicalSearchBackend,
	repository: { name: string; rootPath: string; registeredAt: string },
): Promise<Record<string, string[]>> {
	const searches: Record<string, string[]> = {};

	for (const query of boundaryQueries) {
		const hits = await backend.searchRepository(repository, {
			query,
			limit: 10,
		});
		searches[query] = hits.map((hit) => hit.path);
	}

	return searches;
}

test("BootstrapRipgrepLexicalSearchBackend ripgrep search respects directory and file-size boundaries", async (t) => {
	if (!hasRipgrep()) {
		t.skip("ripgrep is not available in this environment");
	}

	const { repository } = await createBoundaryFixture(t);
	const backend = new BootstrapRipgrepLexicalSearchBackend(
		{
			kind: "ripgrep",
			executable: "rg",
			fallbackToNaiveScan: true,
		},
		maxBytesPerFile,
	);

	const searches = await collectSearches(backend, repository);

	assert.deepEqual(searches, {
		"root-hit": ["main.txt"],
		"hidden-hit": [".hidden.txt"],
		"artifact-alpha": [],
		"artifact-beta": [],
		"artifact-gamma": [],
		"node-hit": [],
		"dist-hit": [],
		"data-hit": [],
		"next-hit": [],
		"big-hit": [],
		"bin-hit": [],
	});
});

test("BootstrapRipgrepLexicalSearchBackend naive fallback matches the same lexical boundaries", async (t) => {
	const { repository } = await createBoundaryFixture(t);
	const backend = new BootstrapRipgrepLexicalSearchBackend(
		{
			kind: "ripgrep",
			executable: "missing-rg-for-test",
			fallbackToNaiveScan: true,
		},
		maxBytesPerFile,
	);

	const searches = await collectSearches(backend, repository);

	assert.deepEqual(searches, {
		"root-hit": ["main.txt"],
		"hidden-hit": [".hidden.txt"],
		"artifact-alpha": [],
		"artifact-beta": [],
		"artifact-gamma": [],
		"node-hit": [],
		"dist-hit": [],
		"data-hit": [],
		"next-hit": [],
		"big-hit": [],
		"bin-hit": [],
	});
});

