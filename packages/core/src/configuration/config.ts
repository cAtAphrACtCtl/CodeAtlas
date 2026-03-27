import path from "node:path";

import { readJsonFile } from "../common/json-file.js";

export interface RipgrepLexicalBackendConfig {
	kind: "ripgrep";
	executable: string;
	fallbackToNaiveScan: boolean;
}

export interface ZoektLexicalBackendConfig {
	kind: "zoekt";
	zoektIndexExecutable: string;
	zoektSearchExecutable: string;
	indexRoot: string;
	allowBootstrapFallback: boolean;
	bootstrapFallback: RipgrepLexicalBackendConfig;
}

export type LexicalBackendConfig =
	| RipgrepLexicalBackendConfig
	| ZoektLexicalBackendConfig;

export interface DebugConfig {
	/**
	 * Debug scopes to enable. Use "*" to enable all scopes.
	 * Available scopes: runtime, mcp, indexer, zoekt, ripgrep,
	 * search-service, symbol-search, symbol-extractor, symbol-index,
	 * source-reader, registry, metadata
	 */
	scopes: string[];
	/**
	 * Include verbose error stream tails (stderr/stdout) in error details.
	 * Equivalent to adding "trace" to scopes.
	 */
	trace: boolean;
}

export interface CodeAtlasConfig {
	registryPath: string;
	metadataPath: string;
	indexRoot: string;
	lexicalBackend: LexicalBackendConfig;
	search: {
		defaultLimit: number;
		maxLimit: number;
		maxBytesPerFile: number;
	};
	mcp: {
		serverName: string;
		serverVersion: string;
	};
	debug: DebugConfig;
}

interface PartialRipgrepLexicalBackendConfig {
	kind?: "ripgrep";
	executable?: string;
	fallbackToNaiveScan?: boolean;
}

interface PartialZoektLexicalBackendConfig {
	kind: "zoekt";
	zoektIndexExecutable?: string;
	zoektSearchExecutable?: string;
	indexRoot?: string;
	allowBootstrapFallback?: boolean;
	bootstrapFallback?: PartialRipgrepLexicalBackendConfig;
}

type PartialLexicalBackendConfig =
	| PartialRipgrepLexicalBackendConfig
	| PartialZoektLexicalBackendConfig;

interface PartialCodeAtlasConfig {
	registryPath?: string;
	metadataPath?: string;
	indexRoot?: string;
	lexicalBackend?: PartialLexicalBackendConfig;
	search?: Partial<CodeAtlasConfig["search"]>;
	mcp?: Partial<CodeAtlasConfig["mcp"]>;
	debug?: Partial<DebugConfig>;
}

function resolvePath(baseDir: string, filePath: string): string {
	return path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
}

function resolveExecutablePath(baseDir: string, executable: string): string {
	if (executable.trim() === "") {
		throw new Error("Executable path cannot be empty");
	}

	if (path.isAbsolute(executable)) {
		return executable;
	}

	if (
		executable.startsWith(".") ||
		executable.includes("/") ||
		executable.includes("\\")
	) {
		return path.resolve(baseDir, executable);
	}

	return executable;
}

function defaultRipgrepLexicalBackendConfig(): RipgrepLexicalBackendConfig {
	return {
		kind: "ripgrep",
		executable: "rg",
		fallbackToNaiveScan: true,
	};
}

function resolveLexicalBackendConfig(
	baseDir: string,
	config?: PartialLexicalBackendConfig,
	topLevelIndexRoot?: string,
): LexicalBackendConfig {
	const defaultRipgrep = defaultRipgrepLexicalBackendConfig();

	if (config?.kind === "zoekt") {
		// Priority for Zoekt indexRoot:
		// 1. Explicit lexicalBackend.indexRoot from user config
		// 2. Derived from top-level indexRoot: ${indexRoot}/zoekt
		// 3. Built-in default: data/indexes/zoekt
		const zoektIndexRoot =
			config.indexRoot ??
			(topLevelIndexRoot
				? path.join(topLevelIndexRoot, "zoekt")
				: "data/indexes/zoekt");

		return {
			kind: "zoekt",
			zoektIndexExecutable: resolveExecutablePath(
				baseDir,
				config.zoektIndexExecutable ?? "zoekt-index",
			),
			zoektSearchExecutable: resolveExecutablePath(
				baseDir,
				config.zoektSearchExecutable ?? "zoekt",
			),
			indexRoot: resolvePath(baseDir, zoektIndexRoot),
			allowBootstrapFallback: config.allowBootstrapFallback ?? true,
			bootstrapFallback: {
				...defaultRipgrep,
				...(config.bootstrapFallback ?? {}),
				executable: resolveExecutablePath(
					baseDir,
					config.bootstrapFallback?.executable ?? defaultRipgrep.executable,
				),
				kind: "ripgrep",
			},
		};
	}

	return {
		...defaultRipgrep,
		...(config ?? {}),
		executable: resolveExecutablePath(
			baseDir,
			config?.executable ?? defaultRipgrep.executable,
		),
		kind: "ripgrep",
	};
}

export function defaultConfig(baseDir = process.cwd()): CodeAtlasConfig {
	const indexRoot = "data/indexes";
	return {
		registryPath: path.resolve(
			baseDir,
			"data/registry/repositories.local.json",
		),
		metadataPath: path.resolve(
			baseDir,
			"data/metadata/index-status.local.json",
		),
		indexRoot: path.resolve(baseDir, indexRoot),
		lexicalBackend: resolveLexicalBackendConfig(baseDir, undefined, indexRoot),
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

export async function loadConfig(
	configFilePath = process.env.CODEATLAS_CONFIG,
	baseDir = process.cwd(),
): Promise<CodeAtlasConfig> {
	const defaults = defaultConfig(baseDir);

	if (!configFilePath) {
		return defaults;
	}

	const resolvedConfigPath = path.resolve(configFilePath);
	const configDir = path.dirname(resolvedConfigPath);
	const userConfig = await readJsonFile<PartialCodeAtlasConfig>(
		resolvedConfigPath,
		{},
	);
	const userIndexRoot = userConfig.indexRoot ?? defaults.indexRoot;

	return {
		registryPath: resolvePath(
			configDir,
			userConfig.registryPath ?? defaults.registryPath,
		),
		metadataPath: resolvePath(
			configDir,
			userConfig.metadataPath ?? defaults.metadataPath,
		),
		indexRoot: resolvePath(
			configDir,
			userConfig.indexRoot ?? defaults.indexRoot,
		),
		lexicalBackend: resolveLexicalBackendConfig(
			configDir,
			userConfig.lexicalBackend,
			userIndexRoot,
		),
		search: {
			...defaults.search,
			...userConfig.search,
		},
		mcp: {
			...defaults.mcp,
			...userConfig.mcp,
		},
		debug: {
			...defaults.debug,
			...userConfig.debug,
		},
	};
}
