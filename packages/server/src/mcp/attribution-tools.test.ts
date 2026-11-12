// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { projectListSchema, repositoryListSchema, type LogProviderStatus, type Session } from "@agent-cost-analyzer/domain";
import { AnalysisQueryService } from "../services/analysis/analysis-query-service.js";
import { AttributionQueryService } from "../services/cost-attribution/attribution-query-service.js";
import { ProjectCatalog } from "../services/cost-attribution/project-catalog.js";
import { RepositoryListService } from "../services/cost-attribution/repository-list-service.js";
import { RepositoryResolver } from "../services/cost-attribution/repository-resolver.js";
import { SessionAttributor } from "../services/cost-attribution/session-attributor.js";
import { ProfileVendorResolver } from "../services/cost-attribution/vendor-resolver.js";
import { InsightsService } from "../services/insights/insights-service.js";
import { AuditQueryService } from "../services/tool-audit/audit-query-service.js";
import { FakeProvider, lookup } from "../test-support/audit-fakes.js";
import { InMemoryFileSystem } from "../test-support/in-memory-file-system.js";
import { InMemoryProjectStore } from "../test-support/in-memory-project-store.js";
import { createMcpServer } from "./mcp-server.js";

// Phase 15 step 15.4 (docs/plans/cost-by-repository-and-project.md
// §10.1.6): list_repositories, list_projects and list_sessions' repository
// and project filters, over a fixture with a remote, a local and a
// folder-only repository, two projects and an Unattributed capture.

const providerStatus: LogProviderStatus = { activeProviderId: "fake", providers: [{ id: "fake", label: "Fake", available: true }] };

const TOKEN = "ghp_" + "Z".repeat(36);

function summary(id: string, cwd: string | null, startedAt: string, credits?: number): Session {
  return {
    id,
    mode: "analyze",
    providerId: "fake",
    title: `Session ${id}`,
    model: "m",
    turns: [],
    turnCount: 3,
    costAiCredits: credits === undefined ? { known: false, reason: "n/a" } : { known: true, value: credits },
    usageDataAvailable: true,
    startedAt,
    workspace: cwd ? { known: true, cwd } : { known: false, reason: "mitmproxy captures record no working folder." },
  };
}

const sessions = [
  summary("portal-1", "/home/dev/portal", "2026-10-01T09:00:00.000Z", 1.25),
  summary("portal-2", "/home/dev/portal/web", "2026-10-03T09:00:00.000Z", 2),
  summary("scratch", "/home/dev/scratch", "2026-10-02T09:00:00.000Z"),
  summary("notes", "/home/dev/notes", "2026-10-04T09:00:00.000Z"),
  summary("capture", null, "2026-10-05T09:00:00.000Z"),
];

const fs = new InMemoryFileSystem(
  {
    "/home/dev/portal/.git/config": `[remote "origin"]\n\turl = https://x-access-token:${TOKEN}@github.com/Acme/Portal.git\n`,
    "/home/dev/scratch/.git/config": "[core]\n\tbare = false\n",
  },
  ["/home/dev/notes", "/home/dev/portal/web"],
);

const projects = {
  version: 1,
  projects: [
    { id: "portal", name: "Customer portal", client: "Acme Ltd", billingCode: "ACME-7", members: [{ repository: "github.com/acme/portal" }] },
    { id: "lab", name: "Lab", members: [{ repository: "local:/home/dev/scratch" }] },
  ],
};

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
const structured = <T>(result: ToolResult) => result.structuredContent as T;

describe("MCP attribution tools (step 15.4)", () => {
  let client: Client;

  beforeEach(async () => {
    const provider = new FakeProvider("fake", sessions);
    const providers = { listProviders: () => [provider] };
    const catalog = new ProjectCatalog(new InMemoryProjectStore(JSON.stringify(projects)));
    const attributor = new SessionAttributor({
      repositories: new RepositoryResolver(fs),
      projects: catalog,
      vendors: new ProfileVendorResolver([]),
      homeDir: "/home/dev",
    });
    const server = createMcpServer({
      auditQueries: new AuditQueryService(lookup(provider)),
      analysisQueries: new AnalysisQueryService(lookup(provider), new InsightsService(providers, [])),
      attribution: new AttributionQueryService(new RepositoryListService(providers, attributor), catalog, attributor),
      getProviderStatus: async () => providerStatus,
      version: "0.0.0-test",
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
  });

  it("registers list_repositories and list_projects as read-only tools whose output schemas are the domain's", async () => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    for (const name of ["list_repositories", "list_projects"]) {
      const tool = byName.get(name);
      expect(tool?.annotations?.readOnlyHint, name).toBe(true);
      expect(tool?.annotations?.openWorldHint, name).toBe(false);
      expect(tool?.description?.length, name).toBeGreaterThan(60);
      expect(tool?.outputSchema?.type, name).toBe("object");
    }
    expect(Object.keys(byName.get("list_repositories")?.inputSchema.properties ?? {}).sort()).toEqual(
      // threat-model.md §5.6: no includePaths: the model can't ask for local paths.
      ["includeUnattributed", "projectId", "provider", "since", "until"].sort(),
    );
    expect(Object.keys(byName.get("list_sessions")?.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(["repository", "projectId"]));
  });

  describe("list_repositories", () => {
    it("lists every repository with counts, AI Credits coverage and projects, plus the Unattributed bucket", async () => {
      const result = await client.callTool({ name: "list_repositories", arguments: {} });
      const list = repositoryListSchema.parse(result.structuredContent);

      expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toEqual(result.structuredContent);
      expect(list.repositories.map((entry) => [entry.key, entry.sessionCount, entry.turnCount, entry.projectIds])).toEqual([
        ["github.com/acme/portal", 2, 6, ["portal"]],
        ["local:scratch", 1, 3, ["lab"]],
        ["path:notes", 1, 3, []],
      ]);
      expect(list.repositories[0]?.aiCredits).toEqual({ value: 3.25, knownSessions: 2, sessions: 2 });
      expect(list.unattributed).toEqual([
        expect.objectContaining({ reason: "mitmproxy captures record no working folder.", sessionCount: 1 }),
      ]);
    });

    it("keeps unknown AI Credits as null with coverage, never 0", async () => {
      const list = structured<{ repositories: { key: string; aiCredits: unknown }[] }>(
        await client.callTool({ name: "list_repositories", arguments: {} }),
      );
      expect(list.repositories.find((entry) => entry.key === "path:notes")?.aiCredits).toEqual({ value: null, knownSessions: 0, sessions: 1 });
    });

    // threat-model.md §5.6: a logged session can't make the model fetch local
    // paths; they stay in the HTTP API (GET /api/repositories).
    it("never returns a local folder path or credential, even when includePaths is passed", async () => {
      const plain = JSON.stringify(await client.callTool({ name: "list_repositories", arguments: {} }));
      const asked = JSON.stringify(await client.callTool({ name: "list_repositories", arguments: { includePaths: true } }));

      for (const text of [plain, asked]) {
        expect(text).not.toContain("/home/dev");
        expect(text).not.toContain(TOKEN);
      }
    });

    it("filters by project, date window and Unattributed", async () => {
      const lab = repositoryListSchema.parse(
        (await client.callTool({ name: "list_repositories", arguments: { projectId: "lab", includeUnattributed: false } })).structuredContent,
      );
      const window = repositoryListSchema.parse(
        (await client.callTool({ name: "list_repositories", arguments: { since: "2026-10-03", until: "2026-10-04" } })).structuredContent,
      );

      expect(lab.repositories.map((entry) => entry.key)).toEqual(["local:scratch"]);
      expect(lab.unattributed).toEqual([]);
      expect(window.repositories.map((entry) => [entry.key, entry.sessionCount])).toEqual([
        ["github.com/acme/portal", 1],
        ["path:notes", 1],
      ]);
    });

    it("lists the valid provider ids for an unknown one", async () => {
      const result = await client.callTool({ name: "list_repositories", arguments: { provider: "nope" } });
      expect(result.isError).toBe(true);
      expect((result.content as { text: string }[])[0]!.text).toContain("Known providers: fake");
    });
  });

  describe("list_projects", () => {
    // threat-model.md §5.6: no client name or billing code without the opt-in.
    it("returns each project's id, name and members, without client, billing code or the file's location", async () => {
      const result = await client.callTool({ name: "list_projects", arguments: {} });
      const list = projectListSchema.parse(result.structuredContent);

      expect(list.status).toBe("valid");
      expect(list.projects).toEqual([
        { id: "portal", name: "Customer portal", members: [{ repository: "github.com/acme/portal" }] },
        { id: "lab", name: "Lab", members: [{ repository: "local:scratch" }] },
      ]);
      expect(JSON.stringify(result)).not.toContain("Acme Ltd");
      expect(JSON.stringify(result)).not.toContain("ACME-7");
      expect(JSON.stringify(result)).not.toContain("/home/dev");
      expect(JSON.stringify(result)).not.toContain("/settings/projects.json");
    });
  });

  describe("list_sessions", () => {
    it("gives each session its repository key (or null with the reason) and project", async () => {
      const result = await client.callTool({ name: "list_sessions", arguments: { limit: 10 } });
      const { sessions: listed } = structured<{ sessions: Record<string, unknown>[] }>(result);

      expect(listed.map((session) => [session.id, session.repositoryKey, session.projectId])).toEqual([
        ["capture", null, null],
        ["notes", "path:notes", null],
        ["portal-2", "github.com/acme/portal", "portal"],
        ["scratch", "local:scratch", "lab"],
        ["portal-1", "github.com/acme/portal", "portal"],
      ]);
      expect(listed[0]).toMatchObject({ unattributedReason: "mitmproxy captures record no working folder." });
      expect(JSON.stringify(result)).not.toContain("/home/dev");
    });

    it("filters by repository (full or returned key) and by project, with the total after the filter", async () => {
      const byKey = structured<{ total: number; sessions: { id: string }[] }>(
        await client.callTool({ name: "list_sessions", arguments: { repository: "github.com/acme/portal" } }),
      );
      const byRedactedKey = structured<{ total: number; sessions: { id: string }[] }>(
        await client.callTool({ name: "list_sessions", arguments: { repository: "local:scratch" } }),
      );
      const byProject = structured<{ total: number; sessions: { id: string }[] }>(
        await client.callTool({ name: "list_sessions", arguments: { projectId: "lab" } }),
      );

      expect(byKey).toMatchObject({ total: 2 });
      expect(byKey.sessions.map((session) => session.id)).toEqual(["portal-2", "portal-1"]);
      expect(byRedactedKey.sessions.map((session) => session.id)).toEqual(["scratch"]);
      expect(byProject.sessions.map((session) => session.id)).toEqual(["scratch"]);
    });
  });

  it("never returns a credential or a local path from any attribution tool, for any folder or remote (property)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^[a-z]{3,10}$/), fc.stringMatching(/^[A-Za-z0-9]{8,20}$/), async (folder, secret) => {
        const home = `/home/${folder}`;
        const treeFs = new InMemoryFileSystem(
          {
            [`${home}/repo/.git/config`]: `[remote "origin"]\n\turl = https://user:${secret}@gitlab.com/${folder}/repo.git\n`,
            [`${home}/solo/.git/config`]: "[core]\n",
          },
          [`${home}/loose`],
        );
        const provider = new FakeProvider("fake", [
          summary("a", `${home}/repo`, "2026-10-01T00:00:00.000Z"),
          summary("b", `${home}/solo`, "2026-10-01T00:00:00.000Z"),
          summary("c", `${home}/loose`, "2026-10-01T00:00:00.000Z"),
        ]);
        const providers = { listProviders: () => [provider] };
        const catalog = new ProjectCatalog(
          new InMemoryProjectStore(JSON.stringify({ version: 1, projects: [{ id: "p", name: "P", members: [{ repository: `path:${home}/loose` }] }] })),
        );
        const attributor = new SessionAttributor({
          repositories: new RepositoryResolver(treeFs),
          projects: catalog,
          vendors: new ProfileVendorResolver([]),
          homeDir: home,
        });
        const server = createMcpServer({
          auditQueries: new AuditQueryService(lookup(provider)),
          analysisQueries: new AnalysisQueryService(lookup(provider), new InsightsService(providers, [])),
          attribution: new AttributionQueryService(new RepositoryListService(providers, attributor), catalog, attributor),
          getProviderStatus: async () => providerStatus,
          version: "0.0.0-test",
        });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const probe = new Client({ name: "probe", version: "1.0.0" });
        await Promise.all([server.connect(serverTransport), probe.connect(clientTransport)]);
        try {
          const outputs = await Promise.all([
            probe.callTool({ name: "list_repositories", arguments: {} }),
            probe.callTool({ name: "list_projects", arguments: {} }),
            probe.callTool({ name: "list_sessions", arguments: {} }),
          ]);
          const text = JSON.stringify(outputs);
          expect(text).not.toContain(home);
          expect(text).not.toContain(secret);
        } finally {
          await probe.close();
        }
      }),
      { numRuns: 15 },
    );
  });
});
