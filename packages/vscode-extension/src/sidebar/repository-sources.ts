import { createSessionAttributor } from "@agent-cost-analyzer/server/src/composition/create-session-attributor";
import { NodeReadOnlyFileSystem } from "@agent-cost-analyzer/server/src/platform/file-system/node-read-only-file-system";
import { RepositoryResolver } from "@agent-cost-analyzer/server/src/services/cost-attribution/repository-resolver";
import type { SidebarSources } from "./sidebar-controller.js";

// Phase 15 step 15.14 (plan §11.9): where the Sessions view and the status
// bar get repositories from. Each session's from its folder, as the
// Dashboard's attribution resolves it (repositories need no vendors), and
// the open workspace's folders the same way (the extension has no projects
// file, so no aliases apply).
export function createRepositorySources(
  workspaceFolderPaths: () => string[],
): Required<Pick<SidebarSources, "attributeRepositories" | "workspaceRepositoryKeys">> {
  const attributor = createSessionAttributor({ vendorProfiles: [] });
  const folders = new RepositoryResolver(new NodeReadOnlyFileSystem());
  return {
    attributeRepositories: (sessions) => {
      const snapshot = attributor.snapshot();
      return new Map(sessions.map((session) => [session.id, snapshot.repository(session)]));
    },
    workspaceRepositoryKeys: () => {
      const keys = workspaceFolderPaths().flatMap((cwd) => {
        const found = folders.resolve({ known: true, cwd });
        return found.attributed ? [found.repository.key] : [];
      });
      return [...new Set(keys)];
    },
  };
}
