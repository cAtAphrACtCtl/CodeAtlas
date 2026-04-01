import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

import { type CodeAtlasConfig, defaultConfig, loadConfig } from "./config.js";

export class ConfigurationService {
	constructor(
		private readonly baseDir = process.cwd(),
		private readonly platform: NodeJS.Platform = process.platform,
	) {}

	getDefaultConfig(): CodeAtlasConfig {
		return defaultConfig(this.baseDir);
	}

	getDefaultConfigPath(): string {
		const configDir = path.resolve(this.baseDir, "config");
		const candidates = [
			this.platform === "win32"
				? "codeatlas.windows.example.json"
				: "codeatlas.wsl.example.json",
			"codeatlas.example.json",
		];

		for (const candidateName of candidates) {
			const candidatePath = path.resolve(configDir, candidateName);
			if (existsSync(candidatePath)) {
				return candidatePath;
			}
		}

		return path.resolve(configDir, "codeatlas.example.json");
	}

	resolveConfigPath(configFilePath?: string): string {
		return configFilePath
			? path.resolve(configFilePath)
			: this.getDefaultConfigPath();
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
