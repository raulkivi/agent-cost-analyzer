import type {
  ProjectsFile,
  RepositoryAttribution,
  RepositoryList,
  RepositoryListEntry,
  RepositorySource,
  Session,
  SessionAiCreditsTotal,
  UnattributedEntry,
} from "@agent-cost-analyzer/domain";
import { projectIdsForRepository, resolveAlias } from "./project-matcher.js";

// Phase 15 step 15.3: GET /api/repositories, built from session summaries
// (each provider reports `workspace` on them since step 15.1). Pure: the
// session → repository function and the projects file are passed in.
// Aliases merge keys, so a moved folder's path: key joins the repository it
// was mapped to; the entry keeps the best-sourced root (a git remote over a
// folder path). Step 15.4 adds turn counts and the sessions' AI Credits with
// coverage (unknown stays null, constraint 6), and takes the repository from
// SessionAttributor so capture rules apply too.

export { NO_WORKSPACE_REPORTED_REASON } from "./session-attributor.js";

export interface ProviderSessionList {
  providerId: string;
  sessions: readonly Session[];
}

export interface RepositoryListInput {
  providers: RepositoryList["providers"];
  sessions: readonly ProviderSessionList[];
  repositoryOf: (session: Session) => RepositoryAttribution;
  projects: ProjectsFile;
}

const SOURCE_RANK: Record<RepositorySource, number> = {
  "git-remote": 4,
  "git-local": 3,
  "capture-rule": 2,
  "recorded-repository": 1,
  "folder-path": 0,
};

interface Totals {
  sessionCount: number;
  turnCount: number;
  knownSessions: number;
  aiCredits: number;
  providerIds: Set<string>;
}

interface Accumulator extends Totals {
  entry: Pick<RepositoryListEntry, "key" | "source" | "rootPath" | "firstUsedAt" | "lastUsedAt">;
}

function emptyTotals(): Totals {
  return { sessionCount: 0, turnCount: 0, knownSessions: 0, aiCredits: 0, providerIds: new Set<string>() };
}

function add(totals: Totals, providerId: string, session: Session): void {
  totals.sessionCount += 1;
  totals.turnCount += session.turnCount;
  totals.providerIds.add(providerId);
  if (session.costAiCredits.known) {
    totals.knownSessions += 1;
    totals.aiCredits += session.costAiCredits.value;
  }
}

function aiCreditsOf(totals: Totals): SessionAiCreditsTotal {
  return { value: totals.knownSessions > 0 ? totals.aiCredits : null, knownSessions: totals.knownSessions, sessions: totals.sessionCount };
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
  const unattributed = new Map<string, Totals>();
  const rank = new Map<string, number>();

  for (const { providerId, sessions } of input.sessions) {
    for (const session of sessions) {
      const attribution = input.repositoryOf(session);
      if (!attribution.attributed) {
        const bucket = unattributed.get(attribution.reason) ?? emptyTotals();
        add(bucket, providerId, session);
        unattributed.set(attribution.reason, bucket);
        continue;
      }
      const { repository } = attribution;
      const key = resolveAlias(input.projects, repository.key);
      let acc = repositories.get(key);
      if (!acc) {
        acc = { entry: { key, source: repository.source }, ...emptyTotals() };
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
      add(acc, providerId, session);
      widen(acc.entry, session.startedAt);
    }
  }

  const repositoryEntries: RepositoryListEntry[] = [...repositories.values()]
    .map((acc) => ({
      key: acc.entry.key,
      source: acc.entry.source,
      ...(acc.entry.rootPath ? { rootPath: acc.entry.rootPath } : {}),
      sessionCount: acc.sessionCount,
      turnCount: acc.turnCount,
      aiCredits: aiCreditsOf(acc),
      providerIds: [...acc.providerIds].sort(),
      ...(acc.entry.firstUsedAt ? { firstUsedAt: acc.entry.firstUsedAt } : {}),
      ...(acc.entry.lastUsedAt ? { lastUsedAt: acc.entry.lastUsedAt } : {}),
      projectIds: projectIdsForRepository(input.projects, acc.entry.key),
    }))
    .sort((a, b) => b.sessionCount - a.sessionCount || a.key.localeCompare(b.key));

  const unattributedEntries: UnattributedEntry[] = [...unattributed.entries()]
    .map(([reason, bucket]) => ({
      reason,
      sessionCount: bucket.sessionCount,
      turnCount: bucket.turnCount,
      aiCredits: aiCreditsOf(bucket),
      providerIds: [...bucket.providerIds].sort(),
    }))
    .sort((a, b) => b.sessionCount - a.sessionCount || a.reason.localeCompare(b.reason));

  return { repositories: repositoryEntries, unattributed: unattributedEntries, providers: input.providers };
}
