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

export type LexicalBackendConfig = RipgrepLexicalBackendConfig | ZoektLexicalBackendConfig;

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

type PartialLexicalBackendConfig = PartialRipgrepLexicalBackendConfig | PartialZoektLexicalBackendConfig;

interface PartialCodeAtlasConfig {
  registryPath?: string;
  metadataPath?: string;
  indexRoot?: string;
  lexicalBackend?: PartialLexicalBackendConfig;
  search?: Partial<CodeAtlasConfig["search"]>;
  mcp?: Partial<CodeAtlasConfig["mcp"]>;
}

function resolvePath(baseDir: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
}

function defaultRipgrepLexicalBackendConfig(): RipgrepLexicalBackendConfig {
  return {
    kind: "ripgrep",
    executable: "rg",
    fallbackToNaiveScan: true,
  };
}

function resolveLexicalBackendConfig(baseDir: string, config?: PartialLexicalBackendConfig): LexicalBackendConfig {
  const defaultRipgrep = defaultRipgrepLexicalBackendConfig();

  if (config?.kind === "zoekt") {
    return {
      kind: "zoekt",
      zoektIndexExecutable: config.zoektIndexExecutable ?? "zoekt-index",
      zoektSearchExecutable: config.zoektSearchExecutable ?? "zoekt",
      indexRoot: resolvePath(baseDir, config.indexRoot ?? "data/indexes/zoekt"),
      allowBootstrapFallback: config.allowBootstrapFallback ?? true,
      bootstrapFallback: {
        ...defaultRipgrep,
        ...(config.bootstrapFallback ?? {}),
        kind: "ripgrep",
      },
    };
  }

  return {
    ...defaultRipgrep,
    ...(config ?? {}),
    kind: "ripgrep",
  };
}

export function defaultConfig(baseDir = process.cwd()): CodeAtlasConfig {
  return {
    registryPath: path.resolve(baseDir, "data/registry/repositories.local.json"),
    metadataPath: path.resolve(baseDir, "data/metadata/index-status.local.json"),
    indexRoot: path.resolve(baseDir, "data/indexes"),
    lexicalBackend: resolveLexicalBackendConfig(baseDir),
    search: {
      defaultLimit: 20,
      maxLimit: 100,
      maxBytesPerFile: 256 * 1024,
    },
    mcp: {
      serverName: "codeatlas",
      serverVersion: "0.1.0",
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
  const userConfig = await readJsonFile<PartialCodeAtlasConfig>(resolvedConfigPath, {});

  return {
    registryPath: resolvePath(configDir, userConfig.registryPath ?? defaults.registryPath),
    metadataPath: resolvePath(configDir, userConfig.metadataPath ?? defaults.metadataPath),
    indexRoot: resolvePath(configDir, userConfig.indexRoot ?? defaults.indexRoot),
    lexicalBackend: resolveLexicalBackendConfig(configDir, userConfig.lexicalBackend),
    search: {
      ...defaults.search,
      ...userConfig.search,
    },
    mcp: {
      ...defaults.mcp,
      ...userConfig.mcp,
    },
  };
}