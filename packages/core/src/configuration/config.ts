import path from "node:path";

import { readJsonFile } from "../common/json-file.js";

export interface CodeAtlasConfig {
  registryPath: string;
  metadataPath: string;
  indexRoot: string;
  lexicalBackend: {
    kind: "ripgrep";
    executable: string;
    fallbackToNaiveScan: boolean;
    contextLines: number;
  };
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

interface PartialCodeAtlasConfig {
  registryPath?: string;
  metadataPath?: string;
  indexRoot?: string;
  lexicalBackend?: Partial<CodeAtlasConfig["lexicalBackend"]>;
  search?: Partial<CodeAtlasConfig["search"]>;
  mcp?: Partial<CodeAtlasConfig["mcp"]>;
}

function resolvePath(baseDir: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
}

export function defaultConfig(baseDir = process.cwd()): CodeAtlasConfig {
  return {
    registryPath: path.resolve(baseDir, "data/registry/repositories.local.json"),
    metadataPath: path.resolve(baseDir, "data/metadata/index-status.local.json"),
    indexRoot: path.resolve(baseDir, "data/indexes"),
    lexicalBackend: {
      kind: "ripgrep",
      executable: "rg",
      fallbackToNaiveScan: true,
      contextLines: 2,
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
    lexicalBackend: {
      ...defaults.lexicalBackend,
      ...userConfig.lexicalBackend,
    },
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