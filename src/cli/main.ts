#!/usr/bin/env node
/**
 * CodeAtlas CLI — human-facing entry point for direct interaction and debugging.
 *
 * Usage:
 *   node --import tsx src/cli/main.ts <command> [args...]
 *   npm run cli -- <command> [args...]
 *
 * Commands:
 *   list                                              List all registered repositories
 *   register <path> [--name <name>]                  Register a repository and index it
 *   refresh <repo>                                    Re-index a repository
 *   status [repo]                                     Show index status
 *   search <query> [--repos r1,r2] [--limit n]       Lexical code search
 *   symbol <name> [--repos r1,r2] [--kinds k1,k2]   Symbol lookup
 *   read <repo> <file> --start <n> --end <n>         Read a source file range
 */

import path from "node:path";

import type { RepositoryIndexStatus } from "../core/metadata/metadata-store.js";
import type { RepositoryRecord } from "../core/registry/repository-registry.js";
import { createCodeAtlasServices } from "../core/runtime.js";

// ─── Arg parsing helpers ────────────────────────────────────────────────────

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string> } {
	const positional: string[] = [];
	const flags: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (token.startsWith("--")) {
			const key = token.slice(2);
			const next = argv[i + 1];
			if (next !== undefined && !next.startsWith("--")) {
				flags[key] = next;
				i++;
			} else {
				flags[key] = "true";
			}
		} else {
			positional.push(token);
		}
	}
	return { positional, flags };
}

function flagList(flags: Record<string, string>, key: string): string[] | undefined {
	return flags[key] ? flags[key].split(",").filter(Boolean) : undefined;
}

function flagInt(flags: Record<string, string>, key: string): number | undefined {
	const v = flags[key];
	return v !== undefined ? Number.parseInt(v, 10) : undefined;
}

// ─── Output helpers ─────────────────────────────────────────────────────────

function stateSymbol(state: string): string {
	if (state === "ready") return "✓";
	if (state === "error") return "✗";
	if (state === "indexing") return "⟳";
	return "○";
}

function printRepoTable(repos: RepositoryRecord[], statuses: RepositoryIndexStatus[]): void {
	const statusMap = new Map(statuses.map((s) => [s.repo, s]));
	if (repos.length === 0) {
		console.log("No repositories registered.");
		return;
	}
	const header = ["NAME", "STATE", "BACKEND", "SYMBOL", "ROOT"].join("  ");
	console.log(header);
	console.log("─".repeat(header.length + 20));
	for (const repo of repos) {
		const s = statusMap.get(repo.name);
		const state = s?.state ?? "not_indexed";
		const sym = s?.symbolState ?? "—";
		const backend = s?.backend ?? "—";
		console.log(
			`${stateSymbol(state)} ${repo.name.padEnd(24)}  ${state.padEnd(12)}  ${backend.padEnd(8)}  ${sym.padEnd(10)}  ${repo.rootPath}`,
		);
		if (s?.detail) {
			console.log(`  detail: ${s.detail}`);
		}
	}
}

function printStatus(status: RepositoryIndexStatus): void {
	console.log(`repo:           ${status.repo}`);
	console.log(`state:          ${stateSymbol(status.state)} ${status.state}`);
	console.log(`backend:        ${status.backend}`);
	if (status.configuredBackend) console.log(`configured:     ${status.configuredBackend}`);
	if (status.reason) console.log(`reason:         ${status.reason}`);
	if (status.lastIndexedAt) console.log(`last indexed:   ${status.lastIndexedAt}`);
	console.log(`symbol state:   ${status.symbolState ?? "—"}`);
	if (status.symbolCount !== undefined) console.log(`symbol count:   ${status.symbolCount}`);
	if (status.symbolLastIndexedAt) console.log(`symbol indexed: ${status.symbolLastIndexedAt}`);
	if (status.detail) console.log(`detail:         ${status.detail}`);
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdList(): Promise<void> {
	const { registry, metadataStore } = await createCodeAtlasServices();
	const repos = await registry.listRepositories();
	const statuses = await metadataStore.listIndexStatuses();
	printRepoTable(repos, statuses);
}

async function cmdRegister(positional: string[], flags: Record<string, string>): Promise<void> {
	const repoPath = positional[0];
	if (!repoPath) {
		console.error("Usage: codeatlas register <path> [--name <name>]");
		process.exit(1);
	}
	const absPath = path.resolve(repoPath);
	const name = flags.name ?? path.basename(absPath);

	const { registry, indexCoordinator } = await createCodeAtlasServices();
	const existing = await registry.getRepository(name);
	if (existing) {
		console.error(`Repository '${name}' is already registered at ${existing.rootPath}`);
		process.exit(1);
	}

	console.log(`Registering '${name}' at ${absPath}...`);
	const record = await registry.registerRepository({ name, rootPath: absPath });
	console.log(`Registered. Indexing...`);
	const status = await indexCoordinator.refreshRepository(record.name);
	printStatus(status);
}

async function cmdRefresh(positional: string[]): Promise<void> {
	const repoName = positional[0];
	if (!repoName) {
		console.error("Usage: codeatlas refresh <repo>");
		process.exit(1);
	}
	const { indexCoordinator } = await createCodeAtlasServices();
	console.log(`Refreshing '${repoName}'...`);
	const status = await indexCoordinator.refreshRepository(repoName);
	printStatus(status);
}

async function cmdStatus(positional: string[]): Promise<void> {
	const repoName = positional[0];
	const { registry, metadataStore } = await createCodeAtlasServices();

	if (repoName) {
		const status = await metadataStore.getIndexStatus(repoName);
		if (!status) {
			console.error(`No status found for repository '${repoName}'.`);
			process.exit(1);
		}
		printStatus(status);
	} else {
		const repos = await registry.listRepositories();
		const statuses = await metadataStore.listIndexStatuses();
		printRepoTable(repos, statuses);
	}
}

async function cmdSearch(positional: string[], flags: Record<string, string>): Promise<void> {
	const query = positional[0];
	if (!query) {
		console.error("Usage: codeatlas search <query> [--repos r1,r2] [--limit n]");
		process.exit(1);
	}
	const repos = flagList(flags, "repos");
	const limit = flagInt(flags, "limit") ?? 20;

	const { searchService } = await createCodeAtlasServices();
	const response = await searchService.searchLexical({ query, repos, limit });

	if (response.results.length === 0) {
		console.log("No results.");
		return;
	}
	for (const result of response.results) {
		console.log(`\n${result.repo}  ${result.path}:${result.start_line}-${result.end_line}`);
		console.log(result.snippet.trim());
	}
	console.log(`\n${response.results.length} result(s) via ${response.source_type}`);
}

async function cmdSymbol(positional: string[], flags: Record<string, string>): Promise<void> {
	const query = positional[0];
	if (!query) {
		console.error("Usage: codeatlas symbol <name> [--repos r1,r2] [--kinds k1,k2] [--exact]");
		process.exit(1);
	}
	const repos = flagList(flags, "repos");
	const kinds = flagList(flags, "kinds") as
		| import("../core/contracts/search.js").SymbolKind[]
		| undefined;
	const limit = flagInt(flags, "limit") ?? 20;
	const exact = flags.exact === "true";

	const { searchService } = await createCodeAtlasServices();
	const response = await searchService.findSymbols({ query, repos, kinds, limit, exact });

	if (response.results.length === 0) {
		console.log("No symbols found.");
		return;
	}
	for (const sym of response.results) {
		const location = `${sym.path}:${sym.start_line}`;
		const container = sym.container_name ? `(in ${sym.container_name})` : "";
		console.log(`${sym.kind.padEnd(12)} ${sym.name.padEnd(32)} ${sym.repo}  ${location} ${container}`);
	}
	console.log(`\n${response.results.length} symbol(s)`);
}

async function cmdRead(positional: string[], flags: Record<string, string>): Promise<void> {
	const [repo, filePath] = positional;
	const startLine = flagInt(flags, "start");
	const endLine = flagInt(flags, "end");

	if (!repo || !filePath || startLine === undefined || endLine === undefined) {
		console.error("Usage: codeatlas read <repo> <file> --start <n> --end <n>");
		process.exit(1);
	}

	const { sourceReader, registry } = await createCodeAtlasServices();
	const record = await registry.getRepository(repo);
	if (!record) {
		console.error(`Repository '${repo}' is not registered.`);
		process.exit(1);
	}

	const response = await sourceReader.readRange(record, filePath, startLine, endLine);
	console.log(`// ${response.repo}  ${response.path}:${response.start_line}-${response.end_line}`);
	console.log(response.content);
}

function printHelp(): void {
	console.log(`CodeAtlas CLI

Commands:
  list                                              List all registered repositories
  register <path> [--name <name>]                  Register and index a repository
  refresh <repo>                                    Re-index a repository
  status [repo]                                     Show index status (all or one)
  search <query> [--repos r1,r2] [--limit n]       Lexical code search
  symbol <name>   [--repos r1,r2] [--kinds k1,k2] [--exact]  Symbol lookup
  read <repo> <file> --start <n> --end <n>         Read a source file range

Environment:
  CODEATLAS_CONFIG   Path to config file (default: config/codeatlas.json)
`);
}

// ─── Entry point ────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const { positional, flags } = parseArgs(argv);
const command = positional[0];
const rest = positional.slice(1);

switch (command) {
	case "list":
		await cmdList();
		break;
	case "register":
		await cmdRegister(rest, flags);
		break;
	case "refresh":
		await cmdRefresh(rest);
		break;
	case "status":
		await cmdStatus(rest);
		break;
	case "search":
		await cmdSearch(rest, flags);
		break;
	case "symbol":
		await cmdSymbol(rest, flags);
		break;
	case "read":
		await cmdRead(rest, flags);
		break;
	case undefined:
	case "help":
	case "--help":
	case "-h":
		printHelp();
		break;
	default:
		console.error(`Unknown command: ${command}`);
		printHelp();
		process.exit(1);
}
