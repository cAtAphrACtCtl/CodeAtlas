import assert from "node:assert/strict";
import test from "node:test";

import {
	collectRepositoryWarnings,
	getRepositoryWarningsForRepo,
} from "../../src/core/registry/repository-warnings.js";

test("collectRepositoryWarnings reports duplicate root paths", () => {
	const warnings = collectRepositoryWarnings([
		{
			name: "codeatlas",
			rootPath: "C:/git/GitHub/LukeLu/CodeAtlas",
			registeredAt: "2026-04-02T00:00:00.000Z",
		},
		{
			name: "CodeAtlas",
			rootPath: "C:/git/GitHub/LukeLu/CodeAtlas",
			registeredAt: "2026-04-02T00:00:00.000Z",
		},
		{
			name: "other",
			rootPath: "C:/git/GitHub/LukeLu/Other",
			registeredAt: "2026-04-02T00:00:00.000Z",
		},
	]);

	assert.equal(warnings.length, 2);
	assert.deepEqual(
		warnings.map((warning) => ({ repo: warning.repo, peers: warning.peers })),
		[
			{ repo: "codeatlas", peers: ["CodeAtlas"] },
			{ repo: "CodeAtlas", peers: ["codeatlas"] },
		],
	);
});

test("getRepositoryWarningsForRepo returns no warnings for unique roots", () => {
	const warnings = getRepositoryWarningsForRepo(
		[
			{
				name: "alpha",
				rootPath: "/repos/alpha",
				registeredAt: "2026-04-02T00:00:00.000Z",
			},
			{
				name: "beta",
				rootPath: "/repos/beta",
				registeredAt: "2026-04-02T00:00:00.000Z",
			},
		],
		"alpha",
	);

	assert.deepEqual(warnings, []);
});