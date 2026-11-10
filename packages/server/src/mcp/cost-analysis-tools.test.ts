// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { costComparisonSchema, costSeriesSchema, projectCostSchema } from "@agent-cost-analyzer/domain";
import type { ApiService } from "../services/api/api-service.js";
import { AnalysisQueryService } from "../services/analysis/analysis-query-service.js";
import { InsightsService } from "../services/insights/insights-service.js";
import { AuditQueryService } from "../services/tool-audit/audit-query-service.js";
import { FakeProvider, lookup } from "../test-support/audit-fakes.js";
import { connectCostFixture } from "../test-support/cost-analysis-fixture.js";
import type { CostAnalysisQueries } from "../services/cost-analysis/cost-analysis-service.js";
import type { AttributionQueries } from "../services/cost-attribution/attribution-query-service.js";
import { createMcpServer } from "./mcp-server.js";

// Phase 15 step 15.7 (plan §10.1.1, §10.1.3, §10.1.6): get_repository_cost,
// get_project_cost, compare_costs and review_costs' project step, over the
// fixture dataset the golden test uses (three providers, two projects).

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
const structured = (result: ToolResult) => result.structuredContent as Record<string, unknown>;
const textOf = (result: ToolResult): string => (result.content as { text: string }[])[0]!.text;
const NEW_TOOLS = ["compare_costs", "get_project_cost", "get_repository_cost"];

describe("MCP cost analysis tools (step 15.7)", () => {
  let client: Client;
  let api: ApiService;

  beforeEach(async () => {
    ({ client, api } = await connectCostFixture());
  });

  afterEach(async () => {
    await client.close();
  });

  it("lists the three tools, read-only, with their output schemas and the cost-basis text", async () => {
    const { tools } = await client.listTools();
    for (const name of NEW_TOOLS) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool?.annotations?.readOnlyHint, name).toBe(true);
      expect(tool?.outputSchema, name).toBeDefined();
      expect(tool?.description, name).toMatch(/billed.*reported.*priced/i);
      expect(tool?.description, name).toContain("1 AI Credit = $0.01");
    }
    const project = tools.find((tool) => tool.name === "get_project_cost")!;
    expect(Object.keys(project.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["projectId", "since", "until", "bucket", "basis", "pricing", "currency", "topSessions"]),
    );
  });

  it("get_repository_cost returns what GET /api/cost/timeseries returns for that repository", async () => {
    const args = { repository: "github.com/acme/portal-web", bucket: "week", currency: "usd" };
    const mcp = costSeriesSchema.parse(structured(await client.callTool({ name: "get_repository_cost", arguments: args })));
    const http = await api.getCostTimeSeries({ groupBy: "repository", ids: "github.com/acme/portal-web", bucket: "week", currency: "usd" });
    expect(mcp).toEqual(http);
    expect(mcp.total).toMatchObject({ turns: 2, knownTurns: 2 });
    expect(mcp.priceChanges.map((marker) => marker.channel)).toEqual(["github-copilot"]);
  });

  it("get_project_cost returns the project's series as GET /api/cost/timeseries?groupBy=project does, plus its breakdowns", async () => {
    const result = await client.callTool({ name: "get_project_cost", arguments: { projectId: "portal", since: "2026-10-01", until: "2026-10-31" } });
    const cost = projectCostSchema.parse(structured(result));
    const http = await api.getCostTimeSeries({ groupBy: "project", ids: "portal", since: "2026-10-01", until: "2026-10-31" });
    const seriesPart = Object.fromEntries(Object.entries(cost).filter(([key]) => key in http));
    expect(seriesPart).toEqual(http);
    // A priced figure with the price version it used, next to a billed Copilot figure (§10.1.6).
    expect(cost.totals.priced.knownTurns).toBeGreaterThan(0);
    expect(cost.totals.priceVersionIds).toEqual(expect.arrayContaining(["anthropic-api:claude-sonnet-5.5:2026-10-07"]));
    expect(cost.totals.preferredBasisTurns).toMatchObject({ billed: 2, priced: 2 });
  });

  it("compare_costs returns what GET /api/cost/compare returns", async () => {
    const args = { groupBy: "project", ids: ["portal", "billing"], since: "2026-10-01", until: "2026-10-31", comparePeriod: "last-year" };
    const mcp = costComparisonSchema.parse(structured(await client.callTool({ name: "compare_costs", arguments: args })));
    const http = await api.getCostComparison({ ...args, ids: "portal,billing" });
    expect(mcp).toEqual(http);
  });

  it("returns unknown costs as null with their coverage, never 0, for partial and all-unknown selections", async () => {
    const none = costSeriesSchema.parse(structured(await client.callTool({ name: "get_repository_cost", arguments: { repository: "local:scratch" } })));
    expect(none.total).toMatchObject({ turns: 1, knownTurns: 0, usd: null, amounts: [] });
    expect(none.points.every((point) => point.cost.usd === null)).toBe(true);
    expect(JSON.stringify(none)).not.toMatch(/"amount":0[,}]/);

    const partial = costSeriesSchema.parse(structured(await client.callTool({ name: "get_repository_cost", arguments: { repository: "github.com/acme/portal-api" } })));
    expect(partial.total).toMatchObject({ turns: 3, knownTurns: 2 });
    expect(partial.points[0]).toMatchObject({ period: "2026-09", cost: { usd: null } });
  });

  it("puts no local folder path, client name or billing code in any output (§10.1.5)", async () => {
    const outputs = await Promise.all([
      client.callTool({ name: "get_repository_cost", arguments: { repository: "local:scratch" } }),
      client.callTool({ name: "get_project_cost", arguments: { projectId: "portal" } }),
      client.callTool({ name: "compare_costs", arguments: { groupBy: "repository", ids: ["local:scratch", "path:notes"], since: "2026-10-01", until: "2026-10-31" } }),
    ]);
    for (const output of outputs) {
      expect(output.isError).toBeFalsy();
      expect(JSON.stringify(output)).not.toContain("/home/dev");
      expect(JSON.stringify(output)).not.toContain("Acme Corp");
    }
  });

  it("answers an unknown project and bad arguments with an actionable error", async () => {
    const unknown = await client.callTool({ name: "get_project_cost", arguments: { projectId: "nope" } });
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toMatch(/list_projects/);
    const one = await client.callTool({ name: "compare_costs", arguments: { groupBy: "project", ids: ["portal"], since: "2026-10-01", until: "2026-10-31" } });
    expect(one.isError).toBe(true);
    const backwards = await client.callTool({ name: "get_repository_cost", arguments: { repository: "x", since: "2026-10-31", until: "2026-10-01" } });
    expect(backwards.isError).toBe(true);
    expect(textOf(backwards)).toMatch(/since/);
  });

  it("review_costs groups its findings by project when projects exist", async () => {
    const prompt = await client.getPrompt({ name: "review_costs", arguments: {} });
    const text = (prompt.messages[0]!.content as { text: string }).text;
    expect(text).toMatch(/list_projects/);
    expect(text).toMatch(/compare_costs/);
    expect(text).toMatch(/get_project_cost/);
    expect(text).toMatch(/group.*by project/i);
  });
});

describe("a server without cost analyses (the extension's, until step 15.13)", () => {
  it("lists none of the three tools", async () => {
    const provider = new FakeProvider("vscode", []);
    const server = createMcpServer({
      auditQueries: new AuditQueryService(lookup(provider)),
      analysisQueries: new AnalysisQueryService(lookup(provider), new InsightsService({ listProviders: () => [provider] }, [])),
      getProviderStatus: async () => ({ activeProviderId: "vscode", providers: [] }),
      version: "0.0.0-test",
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const local = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), local.connect(clientTransport)]);
    const { tools } = await local.listTools();
    expect(tools.filter((tool) => NEW_TOOLS.includes(tool.name))).toEqual([]);
    await local.close();
  });
});

// Owner question 1 (docs/plans/mcp-apps.md §9.1): the extension has no
// projects, so the unknown-project error also says why; the standalone
// text stays as it was.
describe("get_project_cost with no projects", () => {
  const REASON = "This product has no projects: edit them elsewhere.";

  async function connect(attribution: AttributionQueries | undefined): Promise<Client> {
    const provider = new FakeProvider("vscode", []);
    const server = createMcpServer({
      auditQueries: new AuditQueryService(lookup(provider)),
      analysisQueries: new AnalysisQueryService(lookup(provider), new InsightsService({ listProviders: () => [provider] }, [])),
      getProviderStatus: async () => ({ activeProviderId: "vscode", providers: [] }),
      version: "0.0.0-test",
      costAnalysis: { getProjectCost: async () => null } as unknown as CostAnalysisQueries,
      ...(attribution ? { attribution } : {}),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const local = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), local.connect(clientTransport)]);
    return local;
  }

  const attributionWith = (projects: { id: string }[], reason?: string): AttributionQueries =>
    ({ listProjects: () => ({ status: "missing", projects, problems: [], ...(reason ? { reason } : {}) }) }) as unknown as AttributionQueries;

  it("names the no-projects reason after the unknown-id text", async () => {
    const local = await connect(attributionWith([], REASON));
    const result = await local.callTool({ name: "get_project_cost", arguments: { projectId: "portal" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Unknown project id "portal"');
    expect(textOf(result)).toContain(REASON);
    await local.close();
  });

  it.each([
    ["projects exist", attributionWith([{ id: "other" }], REASON)],
    ["there is no reason", attributionWith([])],
    ["no attribution is served", undefined],
  ])("keeps the plain text when %s", async (_name, attribution) => {
    const local = await connect(attribution);
    const result = await local.callTool({ name: "get_project_cost", arguments: { projectId: "portal" } });
    expect(textOf(result)).toBe('Unknown project id "portal". Call list_projects to find valid ids.');
    await local.close();
  });
});
