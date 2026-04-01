#!/usr/bin/env node

/**
 * migrate-zoekt-index.ts
 *
 * One-time manual migration script that moves Zoekt artifacts from the old
 * shared-root layout into the new per-repository layout.
 *
 * Old layout:  <zoektRoot>/*.zoekt  (all repos mixed together)
 * New layout:  <zoektRoot>/repos/<repoKey>/*.zoekt
 *
 * Usage:
 *   npx tsx scripts/migrate-zoekt-index.ts --from <oldDir> --repo <name> --root-path <path> [--dry-run] [--force-single-repo]
 *
 * Flags:
 *   --from       Path to the old shared Zoekt index directory
 *   --repo       Logical repository name (as registered in CodeAtlas)
 *   --root-path  Absolute filesystem path of the repository root
 *   --dry-run    Print what would happen without moving files
 *   --force-single-repo
 *                Confirm that every loose .zoekt file in <from> belongs to
 *                the single repository identified by --repo and --root-path.
 *
 * Behaviour:
 *   - Refuses to move loose .zoekt shard files by default because the old
 *     flat layout does not preserve reliable per-repository ownership.
 *   - If --force-single-repo is passed, moves all loose .zoekt shard files
 *     from <from> into the per-repo subdirectory under
 *     <from>/repos/<repoKey>/.
 *   - On any failure, prints instructions to manually delete and rebuild.
 */

import { mkdir, readdir, rename, stat } from "node:fs/promises";
import path from "node:path";

import { getRepoBuildDir, toRepoKey } from "../src/core/indexer/repo-artifact-path.js";

function usage(): never {
  console.error(`Usage:
  npx tsx scripts/migrate-zoekt-index.ts --from <oldDir> --repo <name> --root-path <path> [--dry-run] [--force-single-repo]

Options:
  --from        Path to the old shared Zoekt index directory
  --repo        Logical repository name (as registered in CodeAtlas)
  --root-path   Absolute filesystem path of the repository root
  --dry-run     Print what would happen without actually moving files
  --force-single-repo
                Confirm that every loose .zoekt file in --from belongs to the
                repository passed via --repo and --root-path`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  from: string;
  repo: string;
  rootPath: string;
  dryRun: boolean;
  forceSingleRepo: boolean;
} {
  let from = "";
  let repo = "";
  let rootPath = "";
  let dryRun = false;
  let forceSingleRepo = false;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--from" && argv[i + 1]) {
      from = argv[++i];
    } else if (arg === "--repo" && argv[i + 1]) {
      repo = argv[++i];
    } else if (arg === "--root-path" && argv[i + 1]) {
      rootPath = argv[++i];
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--force-single-repo") {
      forceSingleRepo = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
    }
  }

  if (!from || !repo || !rootPath) {
    console.error("Error: --from, --repo, and --root-path are all required.\n");
    usage();
  }

  return {
    from: path.resolve(from),
    repo,
    rootPath: path.resolve(rootPath),
    dryRun,
    forceSingleRepo,
  };
}

function printRecoverySteps(from: string, repo: string, targetDir?: string): void {
  console.error();
  console.error("Recovery steps:");
  console.error(`  1. Manually delete the old shard files in: ${from}`);
  if (targetDir) {
    console.error(`  2. Manually delete the partial target directory: ${targetDir}`);
    console.error(`  3. Run refresh_repo for \"${repo}\" to rebuild the index from scratch.`);
    return;
  }

  console.error(`  2. Run refresh_repo for \"${repo}\" to rebuild the index from scratch.`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // Verify the old directory exists
  let fromStats;
  try {
    fromStats = await stat(args.from);
  } catch {
    console.error(`Error: Old index directory does not exist: ${args.from}`);
    console.error("Nothing to migrate.");
    process.exit(1);
  }

  if (!fromStats.isDirectory()) {
    console.error(`Error: ${args.from} is not a directory.`);
    process.exit(1);
  }

  // Find .zoekt shard files in the old root (not in subdirectories)
  const entries = await readdir(args.from, { withFileTypes: true });
  const shardFiles = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".zoekt"),
  );

  if (shardFiles.length === 0) {
    console.log("No .zoekt shard files found in the old directory. Nothing to migrate.");
    return;
  }

  // Safety check: look for a "repos" subdirectory that already has content.
  // Loose shard files alongside populated per-repo directories are ambiguous.
  const reposDir = path.join(args.from, "repos");
  try {
    const reposDirStats = await stat(reposDir);
    if (reposDirStats.isDirectory()) {
      const existingRepos = await readdir(reposDir);
      if (existingRepos.length > 0 && shardFiles.length > 0) {
        console.error(
          `Error: ${reposDir} already exists and contains entries while loose shard files still remain in ${args.from}.`,
        );
        console.error(
          "This mixed layout is ambiguous. Refusing to move loose shard files automatically.",
        );
        printRecoverySteps(args.from, args.repo);
        process.exit(1);
      }
    }
  } catch {
    // repos dir does not exist yet — this is expected
  }

  const repoKey = toRepoKey(args.repo, args.rootPath);
  const targetDir = getRepoBuildDir(args.from, args.repo, args.rootPath);

  console.log(`Migration plan:`);
  console.log(`  Old directory:  ${args.from}`);
  console.log(`  Repository:     ${args.repo}`);
  console.log(`  Root path:      ${args.rootPath}`);
  console.log(`  Repo key:       ${repoKey}`);
  console.log(`  Target dir:     ${targetDir}`);
  console.log(`  Shard files:    ${shardFiles.length}`);
  console.log(`  Dry run:        ${args.dryRun}`);
  console.log(`  Force move:     ${args.forceSingleRepo}`);
  console.log();

  if (args.dryRun) {
    console.log("Dry-run mode — no files will be moved.\n");
  }

  if (!args.forceSingleRepo) {
    console.error("Refusing to move loose shard files automatically.");
    console.error(
      "The old flat Zoekt layout does not preserve reliable per-repository ownership, so moving every loose .zoekt file into one repo directory is unsafe.",
    );
    console.error(
      "If you have verified that this old Zoekt root contains shards for exactly one repository, rerun with --force-single-repo.",
    );
    console.error("Otherwise, delete the old shards and rebuild with refresh_repo.");
    printRecoverySteps(args.from, args.repo);
    process.exit(1);
  }

  // Create target directory
  if (!args.dryRun) {
    await mkdir(targetDir, { recursive: true });
  }

  let moved = 0;
  let failed = 0;

  for (const shard of shardFiles) {
    const oldPath = path.join(args.from, shard.name);
    const newPath = path.join(targetDir, shard.name);

    if (args.dryRun) {
      console.log(`  [dry-run] Would move: ${shard.name}`);
      console.log(`    from: ${oldPath}`);
      console.log(`    to:   ${newPath}`);
    } else {
      try {
        await rename(oldPath, newPath);
        console.log(`  Moved: ${shard.name}`);
        moved++;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`  FAILED to move ${shard.name}: ${detail}`);
        failed++;
      }
    }
  }

  console.log();

  if (args.dryRun) {
    console.log(`Dry run complete. ${shardFiles.length} file(s) would be moved.`);
    return;
  }

  if (failed > 0) {
    console.error(`Migration completed with errors: ${moved} moved, ${failed} failed.`);
    printRecoverySteps(args.from, args.repo, targetDir);
    process.exit(1);
  }

  console.log(`Migration complete. ${moved} shard file(s) moved to ${targetDir}.`);
}

main().catch((error) => {
  console.error("Migration failed unexpectedly.");
  console.error(error);
  console.error();
  console.error("Recovery steps:");
  console.error("  1. Manually delete the old Zoekt index directory");
  console.error("  2. Run refresh_repo for each registered repository to rebuild indexes from scratch.");
  process.exit(1);
});
