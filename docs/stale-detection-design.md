# Stale Index Detection Design

## Problem

Currently, `stale` state is only triggered when readiness verification fails (missing index files, Zoekt unavailable, backend mismatch). It does not track whether the repository source code has actually changed since the last refresh.

This creates a false `ready` state: an index can be marked `ready` but become out-of-date when source files are modified, deleted, or new files added.

## Solution: File System Watch Point

Capture a "watch point" at the end of each successful refresh:
- Directory modification time of the repository root
- Total file count snapshot
- Last modification time of `.git/HEAD` (if present)

On next `verifyRepositoryReady()`, check if:
1. Repository root directory has been modified since last refresh
2. Active index directory has been modified since repository root (suggests index was not refreshed after source change)
3. `.git/HEAD` exists and is newer than `lastIndexedAt` (suggests new commits)

If any condition is true → mark `stale` with reason `"repository_source_changed"`.

## State Machine

```
not_indexed
    ↓
  [refresh]
    ↓
indexing
    ↓
  [success]
    ↓
ready  ← [watch point captured: repoMtime, indexMtime, gitHeadMtime]
    ↓
  [source files change]
    ↓
stale (reason: repository_source_changed)
    ↓
  [refresh]
    ↓
indexing
    ↓
ready
```

## Metadata Extensions

Add to `RepositoryIndexStatus`:
```typescript
// Watch points from last successful refresh (used to detect stale)
sourceRootMtime?: number;        // mtime of repository root directory
indexRootMtime?: number;         // mtime of active index directory
gitHeadMtime?: number;           // mtime of .git/HEAD if present
sourceFileCount?: number;        // total file count at refresh time (approximate)
```

## Verification Logic

In `verifyRepositoryReady()`:

```typescript
// After existing checks pass, add:
if (existingStatus?.sourceRootMtime) {
  const repoRootStats = await stat(repository.rootPath);
  if (repoRootStats.mtimeMs > existingStatus.sourceRootMtime) {
    return finalizeReadiness({
      ready: false,
      state: "stale",
      reason: "repository_source_changed",
      detail: "Repository source files have been modified since last refresh",
    });
  }
}

// Check git HEAD if present
const gitHeadPath = path.join(repository.rootPath, ".git", "HEAD");
try {
  const gitHeadStats = await stat(gitHeadPath);
  if (existingStatus?.lastIndexedAt && 
      new Date(gitHeadStats.mtimeMs).toISOString() > existingStatus.lastIndexedAt) {
    return finalizeReadiness({
      ready: false,
      state: "stale",
      reason: "repository_source_changed",
      detail: ".git/HEAD is newer than last refresh timestamp",
    });
  }
} catch {
  // .git/HEAD doesn't exist or is unreadable, skip check
}
```

## Refresh Behavior

After successful refresh:
1. Capture `sourceRootMtime = repository.rootPath mtime`
2. Capture `indexRootMtime = active index directory mtime`
3. Capture `gitHeadMtime = .git/HEAD mtime` if present
4. Update `RepositoryIndexStatus` with these values
5. Set state to `ready`

## Fallback Behavior

If watchpoint capture fails (permission denied, file doesn't exist):
- Silently skip watch point capture
- Index remains `ready` (no false stale)
- Next verification will compare existing watch points, not error

If source file check fails:
- Log debug message
- Assume not stale (conservative; could drift but continues service)
- Do not transition to `error` state

## Testing

1. Unit: `verifyRepositoryReady()` recognizes stale when source mtime is newer
2. Unit: `verifyRepositoryReady()` recognizes stale when .git/HEAD is newer
3. Unit: Stale is not reported if mtime is older or equal
4. Integration: Full refresh captures watch points, then modify source, verify stale detected
5. Integration: After refresh, stale clears

## Defer for Phase 3

- Timestamp-based watch points are fragile on distributed or time-sync platforms
- Consider replacing with hash-based watch points (hash directory tree, cache it)
- Would require `sourceTreeHashSnapshot?: string` field
- Phase 2.5: acceptable for single-machine / local development
- Phase 3: consider hash-based staleness for production deployment
