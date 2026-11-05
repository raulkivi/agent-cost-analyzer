import type {
  ProjectsFile,
  RepositoryAttribution,
  RepositoryList,
  RepositoryListEntry,
  RepositorySource,
  Session,
  SessionWorkspace,
  UnattributedEntry,
} from "@agent-cost-analyzer/domain";
import { projectIdsForRepository, resolveAlias } from "./project-matcher.js";

// Phase 15 step 15.3: GET /api/repositories, built from session summaries
// (each provider reports `workspace` on them since step 15.1). Pure: the
// resolver and the projects file are passed in. Aliases merge keys, so a
// moved folder's path: key joins the repository it was mapped to; the
// entry keeps the best-sourced root (a git remote over a folder path).

export const NO_WORKSPACE_REPORTED_REASON = "The provider reported no working folder for this session.";

export interface ProviderSessionList {
  providerId: string;
  sessions: readonly Session[];
}

export interface RepositoryListInput {
  providers: RepositoryList["providers"];
  sessions: readonly ProviderSessionList[];
  resolve: (workspace: SessionWorkspace) => RepositoryAttribution;
  projects: ProjectsFile;
}

const SOURCE_RANK: Record<RepositorySource, number> = { "git-remote": 3, "git-local": 2, "recorded-repository": 1, "folder-path": 0 };

interface Accumulator {
  entry: Omit<RepositoryListEntry, "providerIds" | "projectIds">;
  providerIds: Set<string>;
}

function widen(range: { firstUsedAt?: string; lastUsedAt?: string }, at: string | undefined): void {
  if (!at) {
    return;
  }
  if (!range.firstUsedAt || at < range.firstUsedAt) {
    range.firstUsedAt = at;
  }
  if (!range.lastUsedAt || at > range.lastUsedAt) {
    range.lastUsedAt = at;
  }
}

export function buildRepositoryList(input: RepositoryListInput): RepositoryList {
  const repositories = new Map<string, Accumulator>();
  const unattributed = new Map<string, { sessionCount: number; providerIds: Set<string> }>();
  const rank = new Map<string, number>();

  for (const { providerId, sessions } of input.sessions) {
    for (const session of sessions) {
      const attribution: RepositoryAttribution = session.workspace
        ? input.resolve(session.workspace)
        : { attributed: false, reason: NO_WORKSPACE_REPORTED_REASON };
      if (!attribution.attributed) {
        const bucket = unattributed.get(attribution.reason) ?? { sessionCount: 0, providerIds: new Set<string>() };
        bucket.sessionCount += 1;
        bucket.providerIds.add(providerId);
        unattributed.set(attribution.reason, bucket);
        continue;
      }
      const { repository } = attribution;
      const key = resolveAlias(input.projects, repository.key);
      let acc = repositories.get(key);
      if (!acc) {
        acc = { entry: { key, source: repository.source, sessionCount: 0 }, providerIds: new Set<string>() };
        repositories.set(key, acc);
        rank.set(key, -1);
      }
      if (SOURCE_RANK[repository.source] > rank.get(key)!) {
        rank.set(key, SOURCE_RANK[repository.source]);
        acc.entry.source = repository.source;
        if (repository.rootPath) {
          acc.entry.rootPath = repository.rootPath;
        } else {
          delete acc.entry.rootPath;
        }
      }
      acc.entry.sessionCount += 1;
      acc.providerIds.add(providerId);
      widen(acc.entry, session.startedAt);
    }
  }

  const repositoryEntries: RepositoryListEntry[] = [...repositories.values()]
    .map(({ entry, providerIds }) => ({
      key: entry.key,
      source: entry.source,
      ...(entry.rootPath ? { rootPath: entry.rootPath } : {}),
      sessionCount: entry.sessionCount,
      providerIds: [...providerIds].sort(),
      ...(entry.firstUsedAt ? { firstUsedAt: entry.firstUsedAt } : {}),
      ...(entry.lastUsedAt ? { lastUsedAt: entry.lastUsedAt } : {}),
      projectIds: projectIdsForRepository(input.projects, entry.key),
    }))
    .sort((a, b) => b.sessionCount - a.sessionCount || a.key.localeCompare(b.key));

  const unattributedEntries: UnattributedEntry[] = [...unattributed.entries()]
    .map(([reason, bucket]) => ({ reason, sessionCount: bucket.sessionCount, providerIds: [...bucket.providerIds].sort() }))
    .sort((a, b) => b.sessionCount - a.sessionCount || a.reason.localeCompare(b.reason));

  return { repositories: repositoryEntries, unattributed: unattributedEntries, providers: input.providers };
}
