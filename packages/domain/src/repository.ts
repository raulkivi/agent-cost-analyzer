import { z } from "zod";

// Phase 15 step 15.2 (docs/plans/cost-by-repository-and-project.md §4.2):
// the repository a session's folder belongs to.
//
// `key` is the stable identity: a normalised remote (`github.com/org/app`),
// `local:<main repository root>` for a repository with no remote,
// `repository:<name>` for a provider's recorded plain name (a missing
// folder), or `path:<folder>` when the folder isn't (or is no longer) in a
// repository.
// `source` says how the key was found; `path:` keys come from
// `folder-path` and are only as good as the folder name (the user can merge
// them into a real repository with an alias, plan §7). `capture-rule` is a
// mitmproxy capture assigned by a projects-file capture rule (step 15.4).
export const repositorySourceSchema = z.enum(["git-remote", "git-local", "recorded-repository", "folder-path", "capture-rule"]);

// A path inside the repository, relative and never escaping it; "" is the root.
const pathInRepo = z.string().refine((value) => !value.startsWith("/") && !value.split("/").includes(".."), {
  message: "pathInRepo must be relative to the repository root",
});

export const repositoryRefSchema = z.object({
  key: z.string().min(1),
  source: repositorySourceSchema,
  // The working tree's root on this machine, when the folder is in one.
  rootPath: z.string().min(1).optional(),
  pathInRepo: pathInRepo.optional(),
  branch: z.string().min(1).optional(),
});

// A session (or turn) is attributed to one repository, or it is
// Unattributed with the reason (constraint 6), never silently dropped.
export const repositoryAttributionSchema = z.discriminatedUnion("attributed", [
  z.object({ attributed: z.literal(true), repository: repositoryRefSchema }),
  z.object({ attributed: z.literal(false), reason: z.string().min(1) }),
]);

// Phase 15 step 15.3: GET /api/repositories — every repository the
// providers' sessions resolve to, with the projects that include it, plus
// the Unattributed sessions grouped by reason.
const count = z.number().int().nonnegative();

// Step 15.4: the AI Credits of a group of sessions, from their summaries.
// null when no session's figure is known (constraint 6), with coverage.
export const sessionAiCreditsTotalSchema = z
  .object({ value: z.number().nullable(), knownSessions: count, sessions: count })
  .refine((total) => total.knownSessions <= total.sessions, { message: "knownSessions cannot exceed sessions", path: ["knownSessions"] })
  .refine((total) => (total.value === null) === (total.knownSessions === 0), {
    message: "value is null exactly when no session is known",
    path: ["value"],
  });

export const repositoryListEntrySchema = z.object({
  key: z.string().min(1),
  source: repositorySourceSchema,
  rootPath: z.string().min(1).optional(),
  sessionCount: count,
  turnCount: count,
  aiCredits: sessionAiCreditsTotalSchema,
  providerIds: z.array(z.string()),
  firstUsedAt: z.string().optional(),
  lastUsedAt: z.string().optional(),
  projectIds: z.array(z.string()),
});

export const unattributedEntrySchema = z.object({
  reason: z.string().min(1),
  sessionCount: count,
  turnCount: count,
  aiCredits: sessionAiCreditsTotalSchema,
  providerIds: z.array(z.string()),
});

export const repositoryListProviderSchema = z.object({
  id: z.string(),
  label: z.string(),
  available: z.boolean(),
  unavailableReason: z.string().optional(),
  error: z.string().optional(),
});

export const repositoryListSchema = z.object({
  repositories: z.array(repositoryListEntrySchema),
  unattributed: z.array(unattributedEntrySchema),
  providers: z.array(repositoryListProviderSchema),
});

export type RepositorySource = z.infer<typeof repositorySourceSchema>;
export type RepositoryRef = z.infer<typeof repositoryRefSchema>;
export type RepositoryAttribution = z.infer<typeof repositoryAttributionSchema>;
export type RepositoryListEntry = z.infer<typeof repositoryListEntrySchema>;
export type UnattributedEntry = z.infer<typeof unattributedEntrySchema>;
export type RepositoryList = z.infer<typeof repositoryListSchema>;
export type SessionAiCreditsTotal = z.infer<typeof sessionAiCreditsTotalSchema>;

// §10.1.5: `local:` and `path:` keys carry a folder path on this machine, so
// outputs name them by the folder only (`local:scratch`), and the web app
// shows just the folder's name. Remote keys are left as they are.
const LOCAL_KEY_PREFIXES = ["local:", "path:"] as const;

function lastPathSegment(folder: string): string {
  const parts = folder.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.at(-1) ?? "";
}

export function isLocalRepositoryKey(key: string): boolean {
  return LOCAL_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function redactRepositoryKey(key: string): string {
  const prefix = LOCAL_KEY_PREFIXES.find((candidate) => key.startsWith(candidate));
  return prefix ? `${prefix}${lastPathSegment(key.slice(prefix.length))}` : key;
}

// What a person reads: a local key's folder name, else the key itself.
export function repositoryFolderLabel(key: string): string {
  const prefix = LOCAL_KEY_PREFIXES.find((candidate) => key.startsWith(candidate));
  return prefix ? lastPathSegment(key.slice(prefix.length)) : key;
}
