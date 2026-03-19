import { readdir } from "node:fs/promises";
import path from "node:path";

export interface RepositoryDiscoveryCandidate {
  name: string;
  rootPath: string;
}

const skippedDirectories = new Set(["node_modules", "dist", ".next", "data"]);

export class RepositoryDiscoveryService {
  constructor(private readonly defaultMaxDepth = 4) {}

  async discoverRepositories(rootPath: string, maxDepth = this.defaultMaxDepth): Promise<RepositoryDiscoveryCandidate[]> {
    const results: RepositoryDiscoveryCandidate[] = [];
    await this.walk(path.resolve(rootPath), 0, maxDepth, results);
    return results.sort((left, right) => left.name.localeCompare(right.name));
  }

  private async walk(
    currentPath: string,
    depth: number,
    maxDepth: number,
    results: RepositoryDiscoveryCandidate[],
  ): Promise<void> {
    if (depth > maxDepth) {
      return;
    }

    const entries = await readdir(currentPath, { withFileTypes: true });
    const hasGitDirectory = entries.some((entry) => entry.name === ".git");

    if (hasGitDirectory) {
      results.push({
        name: path.basename(currentPath),
        rootPath: currentPath,
      });
      return;
    }

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !skippedDirectories.has(entry.name))
        .map((entry) => this.walk(path.join(currentPath, entry.name), depth + 1, maxDepth, results)),
    );
  }
}