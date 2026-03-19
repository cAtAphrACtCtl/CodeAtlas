import type { QuickPickItem } from "vscode";

import type { RepositoryDiscoveryCandidate } from "../../../core/src/discovery/repository-discovery.js";
import type { RepositoryIndexStatus } from "../../../core/src/metadata/metadata-store.js";
import type { RepositoryRecord } from "../../../core/src/registry/repository-registry.js";

export function toDiscoveryQuickPickItems(candidates: RepositoryDiscoveryCandidate[]): QuickPickItem[] {
  return candidates.map((candidate) => ({
    label: candidate.name,
    description: candidate.rootPath,
  }));
}

export function toRepositoryStatusQuickPickItems(
  repositories: RepositoryRecord[],
  statuses: RepositoryIndexStatus[],
): QuickPickItem[] {
  const statusMap = new Map(statuses.map((status) => [status.repo, status]));

  return repositories.map((repository) => ({
    label: repository.name,
    description: repository.rootPath,
    detail: statusMap.get(repository.name)?.state ?? "not_indexed",
  }));
}