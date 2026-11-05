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
// them into a real repository with an alias, plan §7).
export const repositorySourceSchema = z.enum(["git-remote", "git-local", "recorded-repository", "folder-path"]);

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

export type RepositorySource = z.infer<typeof repositorySourceSchema>;
export type RepositoryRef = z.infer<typeof repositoryRefSchema>;
export type RepositoryAttribution = z.infer<typeof repositoryAttributionSchema>;
