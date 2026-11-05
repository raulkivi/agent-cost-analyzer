import { describe, expect, it } from "vitest";
import { projectsFileSchema, repositoryListSchema, type RepositoryAttribution, type Session, type SessionWorkspace } from "@agent-cost-analyzer/domain";
import { buildRepositoryList, NO_WORKSPACE_REPORTED_REASON } from "./repository-list-builder.js";

function session(id: string, startedAt: string | undefined, workspace: SessionWorkspace | undefined, aiCredits?: number): Session {
  return {
    id,
    mode: "analyze",
    title: id,
    model: "m",
    turns: [],
    turnCount: 1,
    costAiCredits: aiCredits === undefined ? { known: false, reason: "n/a" } : { known: true, value: aiCredits },
    usageDataAvailable: false,
    ...(startedAt ? { startedAt } : {}),
    ...(workspace ? { workspace } : {}),
  };
}

// A resolver stand-in: folder → key, as the real one would from git files.
const KEYS: Record<string, RepositoryAttribution> = {
  "/home/dev/app": { attributed: true, repository: { key: "github.com/org/app", source: "git-remote", rootPath: "/home/dev/app", pathInRepo: "" } },
  "/home/dev/app/packages/server": {
    attributed: true,
    repository: { key: "github.com/org/app", source: "git-remote", rootPath: "/home/dev/app", pathInRepo: "packages/server" },
  },
  "/home/dev/old-app": { attributed: true, repository: { key: "path:/home/dev/old-app", source: "folder-path" } },
  "/home/dev/notes": { attributed: true, repository: { key: "path:/home/dev/notes", source: "folder-path" } },
};
function resolve(workspace: SessionWorkspace): RepositoryAttribution {
  return workspace.known ? KEYS[workspace.cwd]! : { attributed: false, reason: workspace.reason };
}

// As SessionAttributor.snapshot().repository does, without aliases (the builder applies them).
function repositoryOf(value: Session): RepositoryAttribution {
  return value.workspace ? resolve(value.workspace) : { attributed: false, reason: NO_WORKSPACE_REPORTED_REASON };
}

const projects = projectsFileSchema.parse({
  version: 1,
  projects: [{ id: "portal", name: "Portal", members: [{ repository: "github.com/org/app", path: "packages/server" }] }],
  aliases: { "path:/home/dev/old-app": "github.com/org/app" },
});

describe("buildRepositoryList", () => {
  const list = buildRepositoryList({
    providers: [
      { id: "claude-code", label: "Claude Code", available: true },
      { id: "vscode", label: "VS Code", available: true },
      { id: "mitmproxy", label: "mitmproxy", available: true },
      { id: "pi-agent", label: "pi", available: false, unavailableReason: "No pi sessions directory is configured." },
    ],
    sessions: [
      { providerId: "claude-code", sessions: [
        session("c1", "2026-10-02T09:00:00.000Z", { known: true, cwd: "/home/dev/app" }),
        session("c2", "2026-11-01T09:00:00.000Z", { known: true, cwd: "/home/dev/app/packages/server", branch: "main" }),
        session("c3", "2026-10-15T09:00:00.000Z", { known: true, cwd: "/home/dev/notes" }),
      ] },
      { providerId: "vscode", sessions: [
        session("v1", "2026-09-30T09:00:00.000Z", { known: true, cwd: "/home/dev/old-app" }, 1.5),
        session("v2", undefined, undefined),
      ] },
      { providerId: "mitmproxy", sessions: [
        session("m1", "2026-10-03T09:00:00.000Z", { known: false, reason: "mitmproxy captures record no working folder" }),
        session("m2", "2026-10-04T09:00:00.000Z", { known: false, reason: "mitmproxy captures record no working folder" }),
      ] },
    ],
    repositoryOf,
    projects,
  });

  it("is schema-valid", () => {
    expect(repositoryListSchema.parse(list)).toEqual(list);
  });

  it("merges subfolders of one repository and its aliases into one entry, with first and last use", () => {
    expect(list.repositories[0]).toEqual({
      key: "github.com/org/app",
      source: "git-remote",
      rootPath: "/home/dev/app",
      sessionCount: 3,
      turnCount: 3,
      aiCredits: { value: 1.5, knownSessions: 1, sessions: 3 },
      providerIds: ["claude-code", "vscode"],
      firstUsedAt: "2026-09-30T09:00:00.000Z",
      lastUsedAt: "2026-11-01T09:00:00.000Z",
      projectIds: ["portal"],
    });
  });

  it("lists a folder outside any repository as its own path: entry in no project", () => {
    expect(list.repositories[1]).toEqual({
      key: "path:/home/dev/notes",
      source: "folder-path",
      sessionCount: 1,
      turnCount: 1,
      aiCredits: { value: null, knownSessions: 0, sessions: 1 },
      providerIds: ["claude-code"],
      firstUsedAt: "2026-10-15T09:00:00.000Z",
      lastUsedAt: "2026-10-15T09:00:00.000Z",
      projectIds: [],
    });
    expect(list.repositories).toHaveLength(2);
  });

  it("groups Unattributed sessions by reason, most first, including sessions with no workspace reported", () => {
    expect(list.unattributed).toEqual([
      {
        reason: "mitmproxy captures record no working folder",
        sessionCount: 2,
        turnCount: 2,
        aiCredits: { value: null, knownSessions: 0, sessions: 2 },
        providerIds: ["mitmproxy"],
      },
      {
        reason: NO_WORKSPACE_REPORTED_REASON,
        sessionCount: 1,
        turnCount: 1,
        aiCredits: { value: null, knownSessions: 0, sessions: 1 },
        providerIds: ["vscode"],
      },
    ]);
  });

  it("passes the providers' statuses through", () => {
    expect(list.providers.map((provider) => provider.id)).toEqual(["claude-code", "vscode", "mitmproxy", "pi-agent"]);
  });

  it("orders repositories by session count, then key", () => {
    const tie = buildRepositoryList({
      providers: [],
      sessions: [{ providerId: "p", sessions: [session("a", undefined, { known: true, cwd: "/home/dev/notes" }), session("b", undefined, { known: true, cwd: "/home/dev/app" })] }],
      repositoryOf,
      projects: projectsFileSchema.parse({ version: 1, projects: [] }),
    });

    expect(tie.repositories.map((entry) => entry.key)).toEqual(["github.com/org/app", "path:/home/dev/notes"]);
    expect(tie.repositories[0]).not.toHaveProperty("firstUsedAt");
  });
});
