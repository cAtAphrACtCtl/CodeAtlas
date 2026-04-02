import path from "node:path";

import type { RepositoryRecord } from "./repository-registry.js";

export interface RepositoryWarning {
	repo: string;
	code: "duplicate_root_path";
	severity: "warning";
	rootPath: string;
	peers: string[];
	message: string;
}

function normalizeRootPath(rootPath: string): string {
	const normalized = path.normalize(rootPath);
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function collectRepositoryWarnings(
	repositories: RepositoryRecord[],
): RepositoryWarning[] {
	const byRoot = new Map<string, RepositoryRecord[]>();

	for (const repository of repositories) {
		const key = normalizeRootPath(repository.rootPath);
		const group = byRoot.get(key);
		if (group) {
			group.push(repository);
		} else {
			byRoot.set(key, [repository]);
		}
	}

	const warnings: RepositoryWarning[] = [];
	for (const group of byRoot.values()) {
		if (group.length < 2) {
			continue;
		}

		for (const repository of group) {
			const peers = group
				.filter((candidate) => candidate.name !== repository.name)
				.map((candidate) => candidate.name)
				.sort((left, right) => left.localeCompare(right));
			warnings.push({
				repo: repository.name,
				code: "duplicate_root_path",
				severity: "warning",
				rootPath: repository.rootPath,
				peers,
				message: `Repository shares root path with: ${peers.join(", ")}`,
			});
		}
	}

	return warnings.sort((left, right) => left.repo.localeCompare(right.repo));
}

export function getRepositoryWarningsForRepo(
	repositories: RepositoryRecord[],
	repoName: string,
): RepositoryWarning[] {
	return collectRepositoryWarnings(repositories).filter(
		(warning) => warning.repo === repoName,
	);
}