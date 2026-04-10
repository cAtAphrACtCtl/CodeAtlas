import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { IndexCoordinator } from "../../src/core/indexer/index-coordinator.js";
import { FileMetadataStore } from "../../src/core/metadata/file-metadata-store.js";
import { FileRepositoryRegistry } from "../../src/core/registry/file-repository-registry.js";
import { RipgrepLexicalSearchBackend } from "../../src/core/search/ripgrep-lexical-search-backend.js";
import { SearchService } from "../../src/core/search/search-service.js";
import { TypeScriptSymbolExtractor } from "../../src/core/search/symbol-extractor.js";
import { FileSymbolIndexStore } from "../../src/core/search/symbol-index-store.js";
import { SymbolSearchBackend } from "../../src/core/search/symbol-search-backend.js";

function createTestConfig(
	tempRoot: string,
	registryPath: string,
	metadataPath: string,
) {
	return {
		registryPath,
		metadataPath,
		indexRoot: path.join(tempRoot, "indexes"),
		lexicalBackend: {
			kind: "ripgrep" as const,
			executable: "rg",
			fallbackToNaiveScan: true,
		},
		indexing: {
			indexBuildTimeoutMs: 120_000,
			symbolConcurrency: 0,
			enableSymbolExtraction: true,
		},
		search: {
			defaultLimit: 20,
			maxLimit: 100,
			maxBytesPerFile: 256 * 1024,
		},
		mcp: {
			serverName: "codeatlas",
			serverVersion: "0.1.0",
		},
		debug: {
			scopes: [],
			trace: false,
		},
	};
}

test("Refresh detects source code changes and triggers re-indexing", async () => {
	const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codeatlas-test-"));
	try {
		// Set up temporary repository
		const repoRoot = path.join(tempRoot, "test-repo");
		await mkdir(repoRoot, { recursive: true });

		// Create initial source files
		const srcDir = path.join(repoRoot, "src");
		await mkdir(srcDir, { recursive: true });
		await writeFile(
			path.join(srcDir, "module.ts"),
			"export function getConfig() {\n  return { version: '1.0.0' };\n}",
		);

		// Set up registry, metadata, and coordinator
		const registryPath = path.join(tempRoot, "registry.json");
		const metadataPath = path.join(tempRoot, "metadata.json");
		const config = createTestConfig(tempRoot, registryPath, metadataPath);

		const registry = new FileRepositoryRegistry(registryPath);
		const metadataStore = new FileMetadataStore(metadataPath);

		const lexicalBackend = new RipgrepLexicalSearchBackend({
			...config.lexicalBackend,
		});

		const symbolExtractor = new TypeScriptSymbolExtractor();

		const symbolIndexStore = new FileSymbolIndexStore(
			path.join(tempRoot, "indexes"),
		);

		const coordinator = new IndexCoordinator(
			registry,
			metadataStore,
			lexicalBackend,
			symbolExtractor,
			symbolIndexStore,
			{ enableSymbolExtraction: config.indexing.enableSymbolExtraction },
		);

		// Register the repository
		const registered = await registry.registerRepository({
			name: "test-repo",
			rootPath: repoRoot,
		});
		assert(registered);

		// Perform initial refresh to establish baseline
		const initialStatus = await coordinator.refreshRepository("test-repo");
		assert.equal(initialStatus.state, "ready");
		assert.equal(initialStatus.symbolState, "ready");

		// Capture baseline search results
		const searchService = new SearchService(
			registry,
			coordinator,
			lexicalBackend,
			new SymbolSearchBackend(lexicalBackend),
			config.search,
		);

		const baselineResults = await searchService.searchLexical({
			query: "version",
			repos: ["test-repo"],
		});
		assert.ok(baselineResults.results.length > 0, "Should find baseline results");

		// Capture watch points after initial refresh
		const statusAfterInitial = await metadataStore.getIndexStatus("test-repo");
		assert.ok(statusAfterInitial?.sourceRootMtime);
		const initialMtime = statusAfterInitial.sourceRootMtime;

		// Modify source files to trigger staleness detection
		const modifiedContent =
			"export function getConfig() {\n  return { version: '2.0.0', updated: true };\n}";
		await writeFile(path.join(srcDir, "module.ts"), modifiedContent);

		// Update source root directory by creating a new file in it
		await writeFile(path.join(repoRoot, "newfile.ts"), "// temporary file");

		// Trigger another refresh
		const afterModificationStatus = await coordinator.refreshRepository(
			"test-repo",
		);
		assert.equal(afterModificationStatus.state, "ready");
		assert.equal(afterModificationStatus.symbolState, "ready");

		// Verify watch points were updated
		assert.ok(afterModificationStatus.sourceRootMtime);
		assert.ok(
			afterModificationStatus.sourceRootMtime > initialMtime,
			"Watch point mtime should increase after refresh",
		);

		// Verify searches still work after refresh
		const updatedResults = await searchService.searchLexical({
			query: "version",
			repos: ["test-repo"],
		});
		assert.ok(updatedResults.results.length > 0, "Should still find results after refresh");
	} finally {
		await rm(tempRoot, { recursive: true, force: true });
	}
});

