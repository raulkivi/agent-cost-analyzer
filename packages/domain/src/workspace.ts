import { z } from "zod";

// Phase 15 step 15.1 (docs/plans/cost-by-repository-and-project.md §4.1):
// the working folder an Analyze session (or one turn) ran in, as its log
// records it, before any repository resolution (§4.2). Like TokenCount, an
// unknown workspace carries its reason rather than an empty folder
// (constraint 6). `repositoryHint` is the provider's own repository name
// (e.g. the VS Code session store's `repository` column), a hint for the
// resolver, not a resolved repository key.
const nonEmpty = z.string().min(1);

export const sessionWorkspaceSchema = z.discriminatedUnion("known", [
  z.object({
    known: z.literal(true),
    cwd: nonEmpty,
    repositoryHint: nonEmpty.optional(),
    branch: nonEmpty.optional(),
  }),
  z.object({ known: z.literal(false), reason: nonEmpty }),
]);

export type SessionWorkspace = z.infer<typeof sessionWorkspaceSchema>;
export type KnownSessionWorkspace = Extract<SessionWorkspace, { known: true }>;

function present(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

// A known workspace from raw log values; null when the folder is missing or
// blank, so each provider states its own reason with unknownWorkspace.
export function knownWorkspace(
  cwd: string | null | undefined,
  hints: { repositoryHint?: string | null; branch?: string | null } = {},
): KnownSessionWorkspace | null {
  const folder = present(cwd);
  if (!folder) {
    return null;
  }
  const repositoryHint = present(hints.repositoryHint);
  const branch = present(hints.branch);
  return {
    known: true,
    cwd: folder,
    ...(repositoryHint ? { repositoryHint } : {}),
    ...(branch ? { branch } : {}),
  };
}

export function unknownWorkspace(reason: string): SessionWorkspace {
  return { known: false, reason };
}
