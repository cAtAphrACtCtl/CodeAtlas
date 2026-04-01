import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
	getRepoBuildDir,
	getRepoIndexDir,
	repoIdentityHash,
	toRepoKey,
	toSafeRepoSlug,
} from "../../src/core/indexer/repo-artifact-path.js";

// --- toSafeRepoSlug ---

test("toSafeRepoSlug lowercases and keeps safe characters", () => {
	assert.equal(toSafeRepoSlug("My-Project.v2"), "my-project.v2");
});

test("toSafeRepoSlug replaces unsafe characters with dashes", () => {
	assert.equal(toSafeRepoSlug("repo@foo/bar"), "repo-foo-bar");
});

test("toSafeRepoSlug collapses consecutive dashes", () => {
	assert.equal(toSafeRepoSlug("a---b"), "a-b");
});

test("toSafeRepoSlug trims leading and trailing dashes", () => {
	assert.equal(toSafeRepoSlug("--hello--"), "hello");
});

test("toSafeRepoSlug truncates to 40 characters", () => {
	const long = "a".repeat(60);
	assert.equal(toSafeRepoSlug(long).length, 40);
});

test("toSafeRepoSlug returns 'repo' for empty or all-unsafe input", () => {
	assert.equal(toSafeRepoSlug(""), "repo");
	assert.equal(toSafeRepoSlug("///"), "repo");
});

test("toSafeRepoSlug handles spaces and special chars", () => {
	assert.equal(toSafeRepoSlug("My Cool Project!"), "my-cool-project");
});

// --- repoIdentityHash ---

test("repoIdentityHash returns 8-char hex string", () => {
	const hash = repoIdentityHash("repo-a", "C:\\repos\\repo-a");
	assert.match(hash, /^[0-9a-f]{8}$/);
});

test("repoIdentityHash is stable for same inputs", () => {
	const a = repoIdentityHash("repo-a", "/home/user/repo-a");
	const b = repoIdentityHash("repo-a", "/home/user/repo-a");
	assert.equal(a, b);
});

test("repoIdentityHash differs for different repo names", () => {
	const a = repoIdentityHash("repo-a", "/repos/project");
	const b = repoIdentityHash("repo-b", "/repos/project");
	assert.notEqual(a, b);
});

test("repoIdentityHash differs for different root paths", () => {
	const a = repoIdentityHash("project", "/repos/project-v1");
	const b = repoIdentityHash("project", "/repos/project-v2");
	assert.notEqual(a, b);
});

// --- toRepoKey ---

test("toRepoKey combines slug and hash", () => {
	const key = toRepoKey("my-project", "C:\\repos\\my-project");
	assert.match(key, /^my-project-[0-9a-f]{8}$/);
});

test("toRepoKey produces different keys for repos that sanitize to the same slug", () => {
	const a = toRepoKey("repo@v1", "/repos/v1");
	const b = toRepoKey("repo/v1", "/repos/v1-alt");
	// Both slugs would be "repo-v1" but hashes differ
	assert.notEqual(a, b);
});

// --- getRepoIndexDir / getRepoBuildDir ---

test("getRepoIndexDir returns path under repos subdirectory", () => {
	const dir = getRepoIndexDir("/data/zoekt", "my-project", "/repos/my-project");
	const relative = path.relative("/data/zoekt", dir);
	assert.ok(relative.startsWith("repos"));
	assert.ok(relative.includes("my-project"));
});

test("getRepoBuildDir returns the same path as getRepoIndexDir today", () => {
	const indexDir = getRepoIndexDir("/data/zoekt", "repo-a", "/repos/a");
	const buildDir = getRepoBuildDir("/data/zoekt", "repo-a", "/repos/a");
	assert.equal(indexDir, buildDir);
});

test("different repos get different directories under the same shared root", () => {
	const dirA = getRepoIndexDir("/data/zoekt", "repo-a", "/repos/a");
	const dirB = getRepoIndexDir("/data/zoekt", "repo-b", "/repos/b");
	assert.notEqual(dirA, dirB);
});

test("same repo with same root always gets the same directory", () => {
	const dir1 = getRepoIndexDir("/data/zoekt", "repo-a", "/repos/a");
	const dir2 = getRepoIndexDir("/data/zoekt", "repo-a", "/repos/a");
	assert.equal(dir1, dir2);
});

