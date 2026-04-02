import { createHash } from "node:crypto";
import path from "node:path";

/**
 * Sanitize a repository name into a safe filesystem directory component.
 *
 * Rules:
 * - lowercase
 * - only [a-z0-9._-] are kept; everything else becomes "-"
 * - collapse consecutive dashes
 * - trim leading/trailing dashes
 * - truncate to 40 characters
 */
export function toSafeRepoSlug(repoName: string): string {
	const slug = repoName
		.toLowerCase()
		.replace(/[^a-z0-9._-]/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);

	return slug || "repo";
}

/**
 * Produce a short (8-char hex) hash from the repo identity.
 *
 * The identity is `repoName + "\0" + resolvedRootPath` so that:
 * - two repos with different names but the same rootPath get different keys
 * - two repos with the same name but different rootPaths get different keys
 * - sanitized slug collisions are disambiguated
 */
export function repoIdentityHash(repoName: string, rootPath: string): string {
	const identity = `${repoName}\0${rootPath}`;
	return createHash("sha256").update(identity).digest("hex").slice(0, 8);
}

/**
 * Build a stable, filesystem-safe repo key: `<slug>-<hash>`.
 *
 * Example: "my-project-a1b2c3d4"
 */
export function toRepoKey(repoName: string, rootPath: string): string {
	const slug = toSafeRepoSlug(repoName);
	const hash = repoIdentityHash(repoName, rootPath);
	return `${slug}-${hash}`;
}

export function getRepoArtifactDir(
	sharedRoot: string,
	repoName: string,
	rootPath: string,
): string {
	return path.join(sharedRoot, "repos", toRepoKey(repoName, rootPath));
}

export function getRepoActiveDir(
	sharedRoot: string,
	repoName: string,
	rootPath: string,
): string {
	return path.join(getRepoArtifactDir(sharedRoot, repoName, rootPath), "active");
}

export function getRepoStagingDir(
	sharedRoot: string,
	repoName: string,
	rootPath: string,
): string {
	return path.join(getRepoArtifactDir(sharedRoot, repoName, rootPath), "staging");
}

export function getRepoPreviousDir(
	sharedRoot: string,
	repoName: string,
	rootPath: string,
): string {
	return path.join(getRepoArtifactDir(sharedRoot, repoName, rootPath), "previous");
}

/**
 * Resolve the per-repository artifact directory under a shared root.
 *
 * Layout: `<sharedRoot>/repos/<repoKey>/active/`
 */
export function getRepoIndexDir(
	sharedRoot: string,
	repoName: string,
	rootPath: string,
): string {
	return getRepoActiveDir(sharedRoot, repoName, rootPath);
}

/** Build output goes to staging until promotion succeeds. */
export function getRepoBuildDir(
	sharedRoot: string,
	repoName: string,
	rootPath: string,
): string {
	return getRepoStagingDir(sharedRoot, repoName, rootPath);
}
