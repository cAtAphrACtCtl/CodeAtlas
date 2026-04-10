# Stale Index Detection Status

This document records current implementation status for stale detection.

## Original Problem

`stale` state originally depended on lexical readiness failures only (missing shards, backend mismatch, backend unavailable) and did not detect repository source changes after a successful refresh.

## Current Implementation

CodeAtlas now captures timestamp watch points after successful refresh and checks them during lexical readiness verification.

Captured watch points:

- `sourceRootMtime` from repository root directory
- `gitHeadMtime` from `.git/HEAD` when present

Current stale checks in `verifyRepositoryReady()`:

1. repository root mtime newer than stored `sourceRootMtime`
2. `.git/HEAD` mtime newer than `lastIndexedAt`

If either condition is true, readiness returns:

- `state: "stale"`
- `reason: "repository_source_changed"`

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
ready  ← [watch points captured: sourceRootMtime, gitHeadMtime]
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

## Metadata Fields

`RepositoryIndexStatus` includes:

```typescript
sourceRootMtime?: number;
indexRootMtime?: number;
gitHeadMtime?: number;
```

Notes:

- `sourceRootMtime` and `gitHeadMtime` are captured and used today.
- `indexRootMtime` exists in the status type but is not actively captured and compared in the current implementation.

## Current Fallback Behavior

If watch-point capture fails (permission denied, file missing, unreadable):

- capture is skipped
- index remains `ready`
- no transition to `error`

If source-change checks fail at verification time:

- debug logging is emitted
- stale transition is skipped for that failed check
- no transition to `error`

## Testing Status

Implemented:

- integration coverage for refresh-after-source-change flow and watch-point updates

Still recommended:

1. explicit unit test for source mtime stale detection
2. explicit unit test for `.git/HEAD` stale detection
3. explicit non-stale boundary test for equal timestamps

## Deferred Work

- hash-based stale detection for clock-skew or distributed environments
- optional content-signature snapshots (for example, source tree hash)
- proactive auto-refresh scheduling (current model is still request-driven)
