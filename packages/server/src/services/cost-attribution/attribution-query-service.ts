import type { ProjectFileProblem, ProjectList, ProjectsFile, RepositoryList, Session } from "@agent-cost-analyzer/domain";
import type { ProjectCatalog } from "./project-catalog.js";
import { isLocalKey, redactKeysInText, redactRepositoryKey } from "./repository-key-privacy.js";
import type { RepositoryListFilter, RepositoryListService } from "./repository-list-service.js";
import type { SessionAttribution } from "./session-attributor.js";

// Phase 15 step 15.4 (docs/plans/cost-by-repository-and-project.md §10.1):
// the attribution queries the MCP tools list_repositories, list_projects
// and list_sessions' repository/project filters read, over narrow ports
// (DIP). It applies §10.1.5's privacy rule: local folder paths (`local:` and
// `path:` keys, root paths) are left out unless the caller asks for them.

export interface RepositoryQuery extends RepositoryListFilter {
  projectId?: string;
  includeUnattributed?: boolean;
  includePaths?: boolean;
}

export interface SessionAttributionView {
  // Redacted (folder name only for local keys); null: Unattributed.
  repositoryKey: string | null;
  unattributedReason?: string;
  projectId: string | null;
  // The full key, for matching a filter; never returned by a tool.
  fullKey: string | null;
}

export interface AttributionQueries {
  listRepositories(query: RepositoryQuery): Promise<RepositoryList>;
  listProjects(): ProjectList;
  sessionAttributions(): (session: Session) => SessionAttributionView;
}

function keysOf(file: ProjectsFile): string[] {
  return [
    ...file.projects.flatMap((project) => project.members.map((member) => member.repository)),
    ...Object.entries(file.aliases).flat(),
    ...file.captureRules.map((rule) => rule.repository),
  ];
}

export class AttributionQueryService implements AttributionQueries {
  constructor(
    private readonly repositories: Pick<RepositoryListService, "getRepositoryList">,
    private readonly catalog: Pick<ProjectCatalog, "load">,
    private readonly attribution: SessionAttribution,
    // Step 15.13 (D19): a product with no projects of its own says why.
    private readonly noProjectsReason?: string,
  ) {}

  async listRepositories(query: RepositoryQuery): Promise<RepositoryList> {
    const { projectId, includeUnattributed = true, includePaths = false, ...filter } = query;
    const list = await this.repositories.getRepositoryList(filter);
    const repositories = list.repositories
      .filter((entry) => projectId === undefined || entry.projectIds.includes(projectId))
      .map(({ rootPath, ...entry }) =>
        includePaths ? { ...entry, ...(rootPath ? { rootPath } : {}) } : { ...entry, key: redactRepositoryKey(entry.key) },
      );
    return { ...list, repositories, unattributed: includeUnattributed ? list.unattributed : [] };
  }

  listProjects(): ProjectList {
    const state = this.catalog.load();
    const keys = keysOf(state.file);
    const redact = (problem: ProjectFileProblem): ProjectFileProblem => ({
      path: redactKeysInText(problem.path, keys),
      message: redactKeysInText(problem.message, keys),
    });
    return {
      status: state.status,
      projects: state.file.projects.map((project) => ({
        id: project.id,
        name: project.name,
        ...(project.client ? { client: project.client } : {}),
        ...(project.billingCode ? { billingCode: project.billingCode } : {}),
        members: project.members.map((member) => ({
          ...member,
          repository: isLocalKey(member.repository) ? redactRepositoryKey(member.repository) : member.repository,
        })),
      })),
      problems: state.problems.map(redact),
      ...(this.noProjectsReason !== undefined ? { reason: this.noProjectsReason } : {}),
    };
  }

  sessionAttributions(): (session: Session) => SessionAttributionView {
    const snapshot = this.attribution.snapshot();
    return (session) => {
      const { repository, projectId } = snapshot.session(session.providerId ?? "", session);
      if (!repository.attributed) {
        return { repositoryKey: null, unattributedReason: repository.reason, projectId: null, fullKey: null };
      }
      return { repositoryKey: redactRepositoryKey(repository.repository.key), projectId, fullKey: repository.repository.key };
    };
  }
}
