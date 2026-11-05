import { describe, expect, it } from "vitest";
import {
  emptyProjectsFile,
  projectsFileSchema,
  type ProjectsFile,
  type RepositoryAttribution,
  type Session,
  type SessionWorkspace,
} from "@agent-cost-analyzer/domain";
import { analyzeSession, turn, usage } from "../../test-support/insights-fakes.js";
import { NO_WORKSPACE_REPORTED_REASON, SessionAttributor } from "./session-attributor.js";
import { ProfileVendorResolver } from "./vendor-resolver.js";

const HOME = "/home/dev";

// cwd → repository, as RepositoryResolver would read it from git config.
const REPOS: Record<string, { key: string; root: string }> = {
  "/work/portal": { key: "github.com/acme/portal", root: "/work/portal" },
  "/work/platform": { key: "github.com/acme/platform", root: "/work/platform" },
};

const fakeResolver = {
  calls: 0,
  resolve(workspace: SessionWorkspace): RepositoryAttribution {
    this.calls += 1;
    if (!workspace.known) {
      return { attributed: false, reason: workspace.reason };
    }
    const root = Object.keys(REPOS).find((candidate) => workspace.cwd === candidate || workspace.cwd.startsWith(`${candidate}/`));
    if (!root) {
      return { attributed: true, repository: { key: `path:${workspace.cwd}`, source: "folder-path" } };
    }
    return {
      attributed: true,
      repository: {
        key: REPOS[root]!.key,
        source: "git-remote",
        rootPath: root,
        pathInRepo: workspace.cwd.slice(root.length + 1),
        ...(workspace.branch ? { branch: workspace.branch } : {}),
      },
    };
  },
};

const vendors = new ProfileVendorResolver([
  { vendorId: "anthropic", displayName: "Anthropic", models: [{ modelId: "claude-sonnet-5.5" }] },
  { vendorId: "openai", displayName: "OpenAI", models: [{ modelId: "gpt-6-luna" }] },
]);

const projectsFile: ProjectsFile = projectsFileSchema.parse({
  version: 1,
  projects: [
    { id: "portal", name: "Customer portal", members: [{ repository: "github.com/acme/portal" }] },
    { id: "portal-api", name: "Portal API", members: [{ repository: "github.com/acme/platform", path: "services/portal-api" }] },
    { id: "infra", name: "Infra", members: [{ repository: "github.com/acme/platform", branches: ["infra/*"] }] },
  ],
  aliases: { "path:/old/portal-checkout": "github.com/acme/portal" },
  captureRules: [{ glob: "~/captures/acme/*.har", repository: "github.com/acme/portal" }],
  channels: { providers: { "claude-code": "acme-bedrock" } },
});

function attributor(file: ProjectsFile = projectsFile) {
  let loads = 0;
  const instance = new SessionAttributor({
    repositories: fakeResolver,
    projects: {
      load: () => {
        loads += 1;
        return { file };
      },
    },
    vendors,
    homeDir: HOME,
  });
  return { instance, loads: () => loads };
}

function withWorkspace(session: Session, cwd: string, branch?: string): Session {
  return { ...session, workspace: { known: true, cwd, ...(branch ? { branch } : {}) } };
}

const sonnet = { ...usage(), model: "claude-sonnet-5.5" };

describe("SessionAttributor", () => {
  it("attributes a session to its folder's repository and the project whose member matches", () => {
    const { instance } = attributor();
    const session = withWorkspace(analyzeSession("s1", undefined, [], "claude-sonnet-5.5"), "/work/portal/web");

    expect(instance.snapshot().session("vscode", session)).toEqual({
      repository: {
        attributed: true,
        repository: { key: "github.com/acme/portal", source: "git-remote", rootPath: "/work/portal", pathInRepo: "web" },
      },
      projectId: "portal",
      vendor: { known: true, vendorId: "anthropic", basis: "profile" },
      channel: { known: true, channel: "github-copilot" },
    });
  });

  it("matches a path scope and a branch scope (D1: at most one project) and leaves the rest in no project", () => {
    const snapshot = attributor().instance.snapshot();
    const at = (cwd: string, branch?: string) => snapshot.session("vscode", withWorkspace(analyzeSession("s", undefined, []), cwd, branch)).projectId;

    expect(at("/work/platform/services/portal-api/src")).toBe("portal-api");
    expect(at("/work/platform/tools", "infra/dns")).toBe("infra");
    expect(at("/work/platform/tools", "main")).toBeNull();
  });

  it("attributes each turn by its own folder where it differs from the session's (Claude Code)", () => {
    const snapshot = attributor().instance.snapshot();
    const moved = { ...turn(1, [], sonnet), workspace: { known: true as const, cwd: "/work/platform/services/portal-api" } };
    const session = withWorkspace(analyzeSession("s1", undefined, [turn(0, [], sonnet), moved]), "/work/portal");

    expect(snapshot.turn("claude-code", session, session.turns[0]!).repository).toMatchObject({ repository: { key: "github.com/acme/portal" } });
    expect(snapshot.turn("claude-code", session, session.turns[0]!).projectId).toBe("portal");
    expect(snapshot.turn("claude-code", session, moved).repository).toMatchObject({ repository: { key: "github.com/acme/platform" } });
    expect(snapshot.turn("claude-code", session, moved).projectId).toBe("portal-api");
  });

  it("takes a turn's vendor from the turn's own model and its channel from the projects file override", () => {
    const snapshot = attributor().instance.snapshot();
    const gpt = { ...turn(0, [], { ...usage(), model: "gpt-6-luna" }) };
    const session = withWorkspace(analyzeSession("s1", undefined, [gpt], "claude-sonnet-5.5"), "/work/portal");

    expect(snapshot.turn("claude-code", session, gpt)).toMatchObject({
      vendor: { known: true, vendorId: "openai" },
      channel: { known: true, channel: "acme-bedrock" },
    });
    expect(snapshot.turn("pi-agent", session, gpt).channel).toEqual({ known: true, channel: "openai-api" });
  });

  it("merges an aliased key into the repository it points to", () => {
    const snapshot = attributor().instance.snapshot();
    const session = withWorkspace(analyzeSession("s1", undefined, []), "/old/portal-checkout");

    expect(snapshot.session("vscode", session)).toMatchObject({
      repository: { attributed: true, repository: { key: "github.com/acme/portal", source: "folder-path" } },
      projectId: "portal",
    });
  });

  it("keeps a session Unattributed, in no project, with the provider's reason or a reason of its own", () => {
    const snapshot = attributor().instance.snapshot();
    const unknown = { ...analyzeSession("s1", undefined, []), workspace: { known: false as const, reason: "No folder recorded." } };

    expect(snapshot.session("vscode", unknown)).toMatchObject({ repository: { attributed: false, reason: "No folder recorded." }, projectId: null });
    expect(snapshot.session("vscode", analyzeSession("s2", undefined, []))).toMatchObject({
      repository: { attributed: false, reason: NO_WORKSPACE_REPORTED_REASON },
      projectId: null,
    });
  });

  it("assigns a mitmproxy capture to a repository by a capture rule, else keeps its reason", () => {
    const snapshot = attributor().instance.snapshot();
    const capture = (filePath: string): Session => ({
      ...analyzeSession("har", undefined, []),
      workspace: { known: false, reason: "mitmproxy captures record no working folder." },
      capture: { filePath },
    });

    expect(snapshot.session("mitmproxy", capture("/home/dev/captures/acme/one.har"))).toMatchObject({
      repository: { attributed: true, repository: { key: "github.com/acme/portal", source: "capture-rule" } },
      projectId: "portal",
    });
    expect(snapshot.session("mitmproxy", capture("/tmp/two.har"))).toMatchObject({
      repository: { attributed: false, reason: "mitmproxy captures record no working folder." },
    });
  });

  it("keeps the vendor and the vendor-API channel unknown with reasons for an unlisted model", () => {
    const snapshot = attributor(emptyProjectsFile()).instance.snapshot();
    const session = withWorkspace(analyzeSession("s1", undefined, [], "mystery-1"), "/work/portal");

    expect(snapshot.session("pi-agent", session)).toMatchObject({
      vendor: { known: false, reason: expect.stringContaining("mystery-1") },
      channel: { known: false, reason: expect.stringContaining("vendor is unknown") },
    });
  });

  it("reads the projects file once per snapshot and names projects and vendors", () => {
    const { instance, loads } = attributor();
    const snapshot = instance.snapshot();
    snapshot.session("vscode", withWorkspace(analyzeSession("a", undefined, []), "/work/portal"));
    snapshot.session("vscode", withWorkspace(analyzeSession("b", undefined, []), "/work/platform"));

    expect(loads()).toBe(1);
    expect(snapshot.projectName("portal")).toBe("Customer portal");
    expect(snapshot.projectName("nope")).toBeUndefined();
    expect(snapshot.vendorLabel("anthropic")).toBe("Anthropic");
  });
});
