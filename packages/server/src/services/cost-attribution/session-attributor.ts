// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ProjectsFile, RepositoryAttribution, Session, SessionWorkspace, Turn } from "@agent-cost-analyzer/domain";
import { matchCaptureRule } from "./capture-rule-matcher.js";
import { resolveChannel, type ChannelResolution } from "./channel-resolver.js";
import { matchProject, resolveAlias } from "./project-matcher.js";
import type { VendorResolution, VendorResolver } from "./vendor-resolver.js";

// Phase 15 step 15.4 (docs/plans/cost-by-repository-and-project.md §9):
// a session, or one of its turns, → the repository it worked in, the one
// project it counts in (D1), the model's vendor and the channel that sold
// the tokens. A turn uses its own folder where the provider recorded one
// (Claude Code), else the session's; and its own model. mitmproxy captures
// record no folder, so a capture rule assigns them by their file's path.
// Every unknown keeps its reason (constraint 6).

export const NO_WORKSPACE_REPORTED_REASON = "The provider reported no working folder for this session.";

// The narrow ports this needs (DIP): RepositoryResolver and ProjectCatalog
// satisfy them; tests pass fakes.
export interface WorkspaceRepositoryResolver {
  resolve(workspace: SessionWorkspace): RepositoryAttribution;
}

export interface ProjectsSource {
  load(): { file: ProjectsFile };
}

export interface SessionAttributorDeps {
  repositories: WorkspaceRepositoryResolver;
  projects: ProjectsSource;
  vendors: VendorResolver;
  // Expands `~` in capture rules.
  homeDir: string;
}

export interface Attribution {
  // The repository key is alias-resolved, so merged keys count as one.
  repository: RepositoryAttribution;
  // null: Unattributed, or no project's member matches ("No project").
  projectId: string | null;
  vendor: VendorResolution;
  channel: ChannelResolution;
}

// Attribution against one read of the projects file, so a whole dataset is
// attributed consistently and the file is read once.
export interface AttributionSnapshot {
  readonly projectsFile: ProjectsFile;
  session(providerId: string, session: Session): Attribution;
  turn(providerId: string, session: Session, turn: Turn): Attribution;
  // The repository alone, from a session summary (no turns needed).
  repository(session: Session, workspace?: SessionWorkspace): RepositoryAttribution;
  projectName(projectId: string): string | undefined;
  vendorLabel(vendorId: string): string;
}

export interface SessionAttribution {
  snapshot(): AttributionSnapshot;
}

export class SessionAttributor implements SessionAttribution {
  constructor(private readonly deps: SessionAttributorDeps) {}

  snapshot(): AttributionSnapshot {
    return new Snapshot(this.deps, this.deps.projects.load().file);
  }
}

class Snapshot implements AttributionSnapshot {
  constructor(
    private readonly deps: SessionAttributorDeps,
    readonly projectsFile: ProjectsFile,
  ) {}

  session(providerId: string, session: Session): Attribution {
    return this.attribute(providerId, session, session.workspace, session.model);
  }

  turn(providerId: string, session: Session, turn: Turn): Attribution {
    return this.attribute(providerId, session, turn.workspace ?? session.workspace, turn.usage.model);
  }

  repository(session: Session, workspace: SessionWorkspace | undefined = session.workspace): RepositoryAttribution {
    const found = this.unaliased(session, workspace);
    if (!found.attributed) {
      return found;
    }
    return { attributed: true, repository: { ...found.repository, key: resolveAlias(this.projectsFile, found.repository.key) } };
  }

  projectName(projectId: string): string | undefined {
    return this.projectsFile.projects.find((project) => project.id === projectId)?.name;
  }

  vendorLabel(vendorId: string): string {
    return this.deps.vendors.label(vendorId);
  }

  private attribute(providerId: string, session: Session, workspace: SessionWorkspace | undefined, model: string): Attribution {
    const repository = this.repository(session, workspace);
    const vendor = this.deps.vendors.vendorOf(model);
    const channel = resolveChannel({ providerId, vendor, overrides: this.projectsFile.channels?.providers });
    const project = repository.attributed
      ? matchProject(this.projectsFile, {
          key: repository.repository.key,
          ...(repository.repository.pathInRepo !== undefined ? { pathInRepo: repository.repository.pathInRepo } : {}),
          ...(repository.repository.branch ? { branch: repository.repository.branch } : {}),
        })
      : null;
    return { repository, projectId: project?.id ?? null, vendor, channel };
  }

  private unaliased(session: Session, workspace: SessionWorkspace | undefined): RepositoryAttribution {
    const resolved: RepositoryAttribution = workspace
      ? this.deps.repositories.resolve(workspace)
      : { attributed: false, reason: NO_WORKSPACE_REPORTED_REASON };
    if (resolved.attributed || !session.capture) {
      return resolved;
    }
    const rule = matchCaptureRule(this.projectsFile.captureRules, session.capture.filePath, this.deps.homeDir);
    return rule ? { attributed: true, repository: { key: rule.repository, source: "capture-rule" } } : resolved;
  }
}
