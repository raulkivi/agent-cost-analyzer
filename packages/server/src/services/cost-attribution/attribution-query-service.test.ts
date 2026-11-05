import { describe, expect, it } from "vitest";
import { projectListSchema, repositoryListSchema, type Session } from "@agent-cost-analyzer/domain";
import { FakeProvider } from "../../test-support/audit-fakes.js";
import { InMemoryFileSystem } from "../../test-support/in-memory-file-system.js";
import { InMemoryProjectStore } from "../../test-support/in-memory-project-store.js";
import { AttributionQueryService } from "./attribution-query-service.js";
import { ProjectCatalog } from "./project-catalog.js";
import { RepositoryListService } from "./repository-list-service.js";
import { RepositoryResolver } from "./repository-resolver.js";
import { SessionAttributor } from "./session-attributor.js";
import { ProfileVendorResolver } from "./vendor-resolver.js";

function summary(id: string, cwd: string | null, providerId: string, credits?: number): Session {
  return {
    id,
    mode: "analyze",
    providerId,
    title: id,
    model: "m",
    turns: [],
    turnCount: 2,
    costAiCredits: credits === undefined ? { known: false, reason: "n/a" } : { known: true, value: credits },
    usageDataAvailable: true,
    startedAt: "2026-10-01T09:00:00.000Z",
    workspace: cwd ? { known: true, cwd } : { known: false, reason: "mitmproxy captures record no working folder." },
  };
}

const fs = new InMemoryFileSystem(
  {
    "/home/dev/portal/.git/config": '[remote "origin"]\n\turl = https://dev:s3cret-token@github.com/Acme/Portal.git\n',
    "/home/dev/scratch/.git/config": "[core]\n\tbare = false\n",
  },
  ["/home/dev/notes", "/home/dev/scratch/tools", "/home/dev/portal/web"],
);

const projectsJson = {
  version: 1,
  projects: [
    {
      id: "portal",
      name: "Customer portal",
      client: "Acme Ltd",
      billingCode: "ACME-1",
      members: [{ repository: "github.com/acme/portal" }, { repository: "local:/home/dev/scratch", path: "tools" }],
      rates: { markupPercent: 10 },
    },
  ],
  aliases: { "path:/home/dev/old": "github.com/acme/portal" },
  captureRules: [{ glob: "/home/dev/captures/*.har", repository: "github.com/acme/portal" }],
};

function service(projects: unknown = projectsJson) {
  const catalog = new ProjectCatalog(new InMemoryProjectStore(JSON.stringify(projects)));
  const attributor = new SessionAttributor({
    repositories: new RepositoryResolver(fs),
    projects: catalog,
    vendors: new ProfileVendorResolver([]),
    homeDir: "/home/dev",
  });
  const providers = {
    listProviders: () => [
      new FakeProvider("vscode", [summary("v1", "/home/dev/portal/web", "vscode", 2.5), summary("v2", "/home/dev/scratch", "vscode")]),
      new FakeProvider("claude-code", [summary("c1", "/home/dev/notes", "claude-code")]),
      new FakeProvider("mitmproxy", [summary("m1", null, "mitmproxy")]),
    ],
  };
  return new AttributionQueryService(new RepositoryListService(providers, attributor), catalog, attributor);
}

describe("AttributionQueryService", () => {
  describe("listRepositories", () => {
    it("lists repositories with remote keys and folder names only, and no root paths, by default", async () => {
      const list = await service().listRepositories({});
      const text = JSON.stringify(list);

      expect(repositoryListSchema.parse(list)).toEqual(list);
      expect(list.repositories.map((entry) => entry.key)).toEqual(["github.com/acme/portal", "local:scratch", "path:notes"]);
      expect(text).not.toContain("/home/dev");
      expect(text).not.toContain("s3cret-token");
      expect(list.unattributed).toEqual([expect.objectContaining({ reason: "mitmproxy captures record no working folder.", sessionCount: 1 })]);
    });

    it("gives local keys and root paths with includePaths", async () => {
      const list = await service().listRepositories({ includePaths: true });

      expect(list.repositories.map((entry) => entry.key)).toContain("local:/home/dev/scratch");
      expect(list.repositories.find((entry) => entry.key === "github.com/acme/portal")?.rootPath).toBe("/home/dev/portal");
    });

    it("narrows to one project's repositories and leaves Unattributed out on request", async () => {
      const list = await service().listRepositories({ projectId: "portal", includeUnattributed: false });

      expect(list.repositories.map((entry) => entry.key)).toEqual(["github.com/acme/portal", "local:scratch"]);
      expect(list.unattributed).toEqual([]);
    });
  });

  describe("listProjects", () => {
    it("lists each project's id, name, client, billing code and member scopes, without rates or the file location", () => {
      const list = service().listProjects();

      expect(projectListSchema.parse(list)).toEqual(list);
      expect(list).toEqual({
        status: "valid",
        projects: [
          {
            id: "portal",
            name: "Customer portal",
            client: "Acme Ltd",
            billingCode: "ACME-1",
            members: [{ repository: "github.com/acme/portal" }, { repository: "local:scratch", path: "tools" }],
          },
        ],
        problems: [],
      });
      expect(JSON.stringify(list)).not.toContain("/settings/projects.json");
    });

    it("redacts local keys in validation problems", () => {
      const tie = {
        version: 1,
        projects: [
          { id: "a", name: "A", members: [{ repository: "path:/home/dev/old-notes" }] },
          { id: "b", name: "B", members: [{ repository: "path:/home/dev/old-notes" }] },
        ],
      };
      const list = service(tie).listProjects();

      expect(list.status).toBe("invalid");
      expect(list.problems[0]?.message).toContain("path:old-notes");
      expect(JSON.stringify(list)).not.toContain("/home/dev");
    });
  });

  describe("sessionAttributions", () => {
    it("gives each session summary its redacted repository key and project, or the Unattributed reason", () => {
      const sessions = [summary("v1", "/home/dev/portal/web", "vscode"), summary("v2", "/home/dev/scratch/tools", "vscode"), summary("m1", null, "mitmproxy")];
      const attribute = service().sessionAttributions();

      expect(sessions.map((session) => attribute(session))).toEqual([
        { repositoryKey: "github.com/acme/portal", projectId: "portal", fullKey: "github.com/acme/portal" },
        { repositoryKey: "local:scratch", projectId: "portal", fullKey: "local:/home/dev/scratch" },
        { repositoryKey: null, unattributedReason: "mitmproxy captures record no working folder.", projectId: null, fullKey: null },
      ]);
    });
  });
});
