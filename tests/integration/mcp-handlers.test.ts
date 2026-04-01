import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { IndexCoordinator } from "../../src/core/indexer/index-coordinator.js";
import { Logger } from "../../src/core/logging/logger.js";
import { FileMetadataStore } from "../../src/core/metadata/file-metadata-store.js";
import { FileSystemSourceReader } from "../../src/core/reader/filesystem-source-reader.js";
import { FileRepositoryRegistry } from "../../src/core/registry/file-repository-registry.js";
import { RipgrepLexicalSearchBackend } from "../../src/core/search/ripgrep-lexical-search-backend.js";
import { SearchService } from "../../src/core/search/search-service.js";
import { TypeScriptSymbolExtractor } from "../../src/core/search/symbol-extractor.js";
import { FileSymbolIndexStore } from "../../src/core/search/symbol-index-store.js";
import { SymbolSearchBackend } from "../../src/core/search/symbol-search-backend.js";
import { createHandlers } from "../../src/mcp-server/mcp/handlers.js";

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
		logging: {
			enabled: false,
			level: "info" as const,
			format: "jsonl" as const,
			file: {
				enabled: false,
				path: path.join(tempRoot, "codeatlas.log.jsonl"),
			},
			includeErrorStreamTails: false,
		},
	};
}

test("MCP handlers expose phase 1 lexical search and source reading", async (t) => {
	const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codeatlas-"));
	t.after(async () => {
		await rm(tempRoot, { recursive: true, force: true });
	});
	const repositoryRoot = path.join(tempRoot, "sample-repo");
	const registryPath = path.join(tempRoot, "registry.json");
	const metadataPath = path.join(tempRoot, "metadata.json");

	await mkdir(path.join(repositoryRoot, "src"), { recursive: true });
	await writeFile(
		path.join(repositoryRoot, "src", "feature.ts"),
		[
			"export interface AtlasConfig {",
			"  name: string;",
			"}",
			"",
			"export function buildAtlas() {",
			"  return 'code atlas';",
			"}",
		].join("\n"),
		"utf8",
	);

	const registry = new FileRepositoryRegistry(registryPath);
	const metadataStore = new FileMetadataStore(metadataPath);
	const backend = new RipgrepLexicalSearchBackend(
		{
			kind: "ripgrep",
			executable: "rg",
			fallbackToNaiveScan: true,
		},
		256 * 1024,
	);
	const symbolIndexStore = new FileSymbolIndexStore(
		path.join(tempRoot, "indexes"),
	);
	const symbolExtractor = new TypeScriptSymbolExtractor();
	const symbolSearchBackend = new SymbolSearchBackend(symbolIndexStore);
	const indexCoordinator = new IndexCoordinator(
		registry,
		metadataStore,
		backend,
		symbolExtractor,
		symbolIndexStore,
	);
	const sourceReader = new FileSystemSourceReader();
	const searchService = new SearchService(
		registry,
		indexCoordinator,
		backend,
		symbolSearchBackend,
		{
			defaultLimit: 20,
			maxLimit: 100,
			maxBytesPerFile: 256 * 1024,
		},
	);

	await registry.registerRepository({
		name: "sample",
		rootPath: repositoryRoot,
	});

	const handlers = createHandlers({
		config: createTestConfig(tempRoot, registryPath, metadataPath),
		registry,
		metadataStore,
		indexCoordinator,
		searchService,
		sourceReader,
		logger: new Logger({ level: "error", enabled: false }),
	});

	const searchResponse = await handlers.codeSearch({
		query: "code atlas",
		repos: ["sample"],
		limit: 5,
	});

	const searchPayload = searchResponse.structuredContent as {
		source_type: string;
		results: Array<{ repo: string; path: string }>;
	};

	assert.equal(searchPayload.source_type, "lexical");
	assert.equal(searchPayload.results.length, 1);
	assert.equal(searchPayload.results[0]?.repo, "sample");
	assert.equal(searchPayload.results[0]?.path, "src/feature.ts");

	const symbolResponse = await handlers.findSymbol({
		query: "buildAtlas",
		repos: ["sample"],
		exact: true,
		limit: 5,
	});

	const symbolPayload = symbolResponse.structuredContent as {
		results: Array<{
			name: string;
			kind: string;
			path: string;
			start_line: number;
			end_line: number;
		}>;
	};

	assert.equal(symbolPayload.results.length, 1);
	assert.equal(symbolPayload.results[0]?.name, "buildAtlas");
	assert.equal(symbolPayload.results[0]?.kind, "function");
	assert.equal(symbolPayload.results[0]?.path, "src/feature.ts");
	assert.equal(symbolPayload.results[0]?.start_line, 5);
	assert.equal(symbolPayload.results[0]?.end_line, 7);

	const readResponse = await handlers.readSource({
		repo: "sample",
		path: "src/feature.ts",
		start_line: 5,
		end_line: 6,
	});

	const readPayload = readResponse.structuredContent as {
		content: string;
		start_line: number;
		end_line: number;
	};

	assert.equal(readPayload.start_line, 5);
	assert.equal(readPayload.end_line, 6);
	assert.match(readPayload.content, /buildAtlas/);
});

test("MCP handlers reject read_source requests when start_line exceeds file length", async (t) => {
	const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codeatlas-"));
	t.after(async () => {
		await rm(tempRoot, { recursive: true, force: true });
	});
	const repositoryRoot = path.join(tempRoot, "sample-repo");
	const registryPath = path.join(tempRoot, "registry.json");
	const metadataPath = path.join(tempRoot, "metadata.json");

	await mkdir(path.join(repositoryRoot, "src"), { recursive: true });
	await writeFile(
		path.join(repositoryRoot, "src", "feature.ts"),
		"export const value = 1;\n",
		"utf8",
	);

	const registry = new FileRepositoryRegistry(registryPath);
	const metadataStore = new FileMetadataStore(metadataPath);
	const backend = new RipgrepLexicalSearchBackend(
		{
			kind: "ripgrep",
			executable: "rg",
			fallbackToNaiveScan: true,
		},
		256 * 1024,
	);
	const symbolIndexStore = new FileSymbolIndexStore(
		path.join(tempRoot, "indexes"),
	);
	const symbolExtractor = new TypeScriptSymbolExtractor();
	const symbolSearchBackend = new SymbolSearchBackend(symbolIndexStore);
	const indexCoordinator = new IndexCoordinator(
		registry,
		metadataStore,
		backend,
		symbolExtractor,
		symbolIndexStore,
	);
	const sourceReader = new FileSystemSourceReader();
	const searchService = new SearchService(
		registry,
		indexCoordinator,
		backend,
		symbolSearchBackend,
		{
			defaultLimit: 20,
			maxLimit: 100,
			maxBytesPerFile: 256 * 1024,
		},
	);

	await registry.registerRepository({
		name: "sample",
		rootPath: repositoryRoot,
	});

	const handlers = createHandlers({
		config: createTestConfig(tempRoot, registryPath, metadataPath),
		registry,
		metadataStore,
		indexCoordinator,
		searchService,
		sourceReader,
		logger: new Logger({ level: "error", enabled: false }),
	});

	await assert.rejects(
		() =>
			handlers.readSource({
				repo: "sample",
				path: "src/feature.ts",
				start_line: 99,
				end_line: 100,
			}),
		/start_line exceeds file length/,
	);
});

test("MCP handlers attach friendly diagnostics when configured Zoekt is unavailable", async () => {
	const handlers = createHandlers({
		config: {
			registryPath: "C:/tmp/registry.json",
			metadataPath: "C:/tmp/metadata.json",
			indexRoot: "C:/tmp/indexes",
			lexicalBackend: {
				kind: "zoekt",
				zoektIndexExecutable: "C:/missing/zoekt-index.exe",
				zoektSearchExecutable: "C:/missing/zoekt.exe",
				indexRoot: "C:/tmp/indexes/zoekt",
				allowBootstrapFallback: true,
				bootstrapFallback: {
					kind: "ripgrep",
					executable: "rg",
					fallbackToNaiveScan: true,
				},
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
			logging: {
				enabled: false,
				level: "info" as const,
				format: "jsonl" as const,
				file: {
					enabled: false,
					path: "C:/tmp/codeatlas.log.jsonl",
				},
				includeErrorStreamTails: false,
			},
		},
		registry: {
			async listRepositories() {
				return [
					{
						name: "sample",
						rootPath: "C:/tmp/sample",
						registeredAt: "2026-03-27T00:00:00.000Z",
					},
				];
			},
			async getRepository() {
				return {
					name: "sample",
					rootPath: "C:/tmp/sample",
					registeredAt: "2026-03-27T00:00:00.000Z",
				};
			},
			async registerRepository() {
				throw new Error("not used");
			},
		},
		metadataStore: {
			async listIndexStatuses() {
				return [];
			},
			async getIndexStatus() {
				return null;
			},
			async setIndexStatus() {},
		},
		indexCoordinator: {
			async ensureReady() {
				throw new Error("not used");
			},
			async ensureLexicalReady() {
				throw new Error("not used");
			},
			async ensureSymbolReady() {
				throw new Error("not used");
			},
			async refreshRepository() {
				return {
					repo: "sample",
					backend: "ripgrep",
					configuredBackend: "zoekt",
					state: "ready" as const,
					reason: "zoekt_unavailable" as const,
					symbolState: "ready" as const,
					detail:
						"Zoekt index executable not available: C:/missing/zoekt-index.exe; using bootstrap fallback: fallback ready",
				};
			},
			async markRepositoryStale() {
				throw new Error("not used");
			},
			async getStatus() {
				return [
					{
						repo: "sample",
						backend: "ripgrep",
						configuredBackend: "zoekt",
						state: "ready" as const,
						reason: "zoekt_unavailable" as const,
						symbolState: "ready" as const,
						detail:
							"Zoekt index executable not available: C:/missing/zoekt-index.exe; using bootstrap fallback: fallback ready",
					},
				];
			},
		} as unknown as IndexCoordinator,
		searchService: {
			async searchLexical() {
				throw new Error("not used");
			},
			async findSymbols() {
				throw new Error("not used");
			},
			async searchSemantic() {
				throw new Error("not used");
			},
			async searchHybrid() {
				throw new Error("not used");
			},
		} as unknown as SearchService,
		sourceReader: {
			async readRange() {
				throw new Error("not used");
			},
		},
		logger: new Logger({ level: "error", enabled: false }),
	});

	const statusResponse = await handlers.getIndexStatus({ repo: "sample" });
	const statusPayload = statusResponse.structuredContent as {
		index_status: Array<{
			backend: string;
			configuredBackend?: string;
			diagnostics?: {
				severity: string;
				summary: string;
				remedies?: string[];
			};
		}>;
	};

	assert.equal(statusPayload.index_status[0]?.backend, "ripgrep");
	assert.equal(statusPayload.index_status[0]?.configuredBackend, "zoekt");
	assert.equal(statusPayload.index_status[0]?.diagnostics?.severity, "warning");
	assert.match(
		statusPayload.index_status[0]?.diagnostics?.summary ?? "",
		/Zoekt is not available/i,
	);
	assert.match(
		(statusPayload.index_status[0]?.diagnostics?.remedies ?? []).join("\n"),
		/zoekt:install:windows|codeatlas\.wsl\.example/i,
	);

	const listResponse = await handlers.listRepos();
	const listPayload = listResponse.structuredContent as {
		repositories: Array<{ name: string }>;
		index_status: Array<{ diagnostics?: { severity: string } }>;
	};

	assert.equal(listPayload.repositories.length, 1);
	assert.equal(listPayload.repositories[0]?.name, "sample");
	assert.equal(listPayload.index_status[0]?.diagnostics?.severity, "warning");

	const refreshResponse = await handlers.refreshRepo({ repo: "sample" });
	const refreshPayload = refreshResponse.structuredContent as {
		index_status: {
			diagnostics?: {
				severity: string;
				impact?: string;
			};
		};
	};

	assert.equal(refreshPayload.index_status.diagnostics?.severity, "warning");
	assert.match(
		refreshPayload.index_status.diagnostics?.impact ?? "",
		/Zoekt-first path|fallback backend|degraded/i,
	);
});

