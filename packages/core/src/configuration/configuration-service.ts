import { access } from "node:fs/promises";
import path from "node:path";

import { defaultConfig, loadConfig, type CodeAtlasConfig } from "./config.js";

export class ConfigurationService {
  constructor(private readonly baseDir = process.cwd()) {}

  getDefaultConfig(): CodeAtlasConfig {
    return defaultConfig(this.baseDir);
  }

  getDefaultConfigPath(): string {
    return path.resolve(this.baseDir, "config/codeatlas.example.json");
  }

  resolveConfigPath(configFilePath?: string): string {
    return configFilePath ? path.resolve(configFilePath) : this.getDefaultConfigPath();
  }

  async configExists(configFilePath?: string): Promise<boolean> {
    try {
      await access(this.resolveConfigPath(configFilePath));
      return true;
    } catch {
      return false;
    }
  }

  async load(configFilePath?: string): Promise<CodeAtlasConfig> {
    return loadConfig(configFilePath, this.baseDir);
  }
}