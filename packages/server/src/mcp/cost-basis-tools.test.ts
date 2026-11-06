import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  costBasisTotals,
  costRollupSchema,
  sessionCostSchema,
  turnViewSchema,
  type LogProviderStatus,
  type Session,
  type TokenCount,
  type Turn,
  type TurnUsage,
} from "@agent-cost-analyzer/domain";
import { createTurnPricer } from "../composition/create-turn-pricer.js";
import { AnalysisQueryService } from "../services/analysis/analysis-query-service.js";
import { ProjectCatalog } from "../services/cost-attribution/project-catalog.js";
import { RepositoryResolver } from "../services/cost-attribution/repository-resolver.js";
import { SessionAttributor } from "../services/cost-attribution/session-attributor.js";
import { ProfileVendorResolver } from "../services/cost-attribution/vendor-resolver.js";
import { InsightsService } from "../services/insights/insights-service.js";
import { BundledPriceBookSource } from "../services/pricing/bundled-price-book-source.js";
import { PriceBook } from "../services/pricing/price-book.js";
import { AuditQueryService } from "../services/tool-audit/audit-query-service.js";
import { FakeProvider, lookup } from "../test-support/audit-fakes.js";
import { InMemoryFileSystem } from "../test-support/in-memory-file-system.js";
import { InMemoryProjectStore } from "../test-support/in-memory-project-store.js";
import { createMcpServer } from "./mcp-server.js";

// Phase 15 step 15.6 (docs/plans/cost-by-repository-and-project.md §10.1.2,
// §10.1.6): the cost basis in get_session_cost, get_cost_rollup and
// get_turn, over the bundled price book, a Copilot session in a project and
// a Claude Code session outside any repository, with known, partial and
// unknown priced figures.

const providerStatus: LogProviderStatus = {
  activeProviderId: "vscode",
  providers: [
    { id: "vscode", label: "VS Code", available: true },
    { id: "claude-code", label: "Claude Code", available: true },
  ],
};

const k = (value: number): TokenCount => ({ known: true, value });
const u = (reason: string): TokenCount => ({ known: false, reason });

function usage(model: string, overrides: Partial<TurnUsage>): TurnUsage {
  return {
    uncachedInput: k(0),
    cacheWrite: k(0),
    cacheRead: k(0),
    tool: u("n/a"),
    vision: u("n/a"),
    reasoning: u("n/a"),
    output: k(0),
    costAiCredits: u("AI Credits are GitHub Copilot's own billing unit."),
    model,
    roundsCount: 1,
    ...overrides,
  };
}

function turnOf(index: number, startedAt: string, turnUsage: TurnUsage): Turn {
  return { index, userMessage: `prompt ${index}`, assistantResponse: "", toolCalls: [], usage: turnUsage, explanation: "", startedAt };
}

function sessionOf(id: string, providerId: string, cwd: string, startedAt: string, turns: Turn[]): Session {
  return {
    id,
    mode: "analyze",
    providerId,
    title: `Session ${id}`,
    model: turns[0]!.usage.model,
    turns,
    turnCount: turns.length,
    costAiCredits: u("n/a"),
    usageDataAvailable: true,
    startedAt,
    workspace: { known: true, cwd },
  };
}

// Copilot: turn 0 fully known (billed 0.9, priced 0.79 AI Credits after the
// 2026-10-07 cache-read cut); turn 1 billed, but its cache writes unknown.
const copilot = sessionOf("copilot-1", "vscode", "/home/dev/portal", "2026-10-08T09:00:00.000Z", [
  turnOf(0, "2026-10-08T09:00:00.000Z", usage("claude-sonnet-5.5", { uncachedInput: k(1000), cacheRead: k(9000), output: k(500), costAiCredits: k(0.9) })),
  turnOf(1, "2026-10-08T09:05:00.000Z", usage("claude-sonnet-5.5", { uncachedInput: k(100), cacheWrite: u("No trace database."), output: k(10), costAiCredits: k(0.5) })),
]);

// Claude Code: turn 0 ran before the book's first price; turn 1 writes cache
// with no lifetime split, priced at the 1-hour rate (Claude Code's default).
const claudeCode = sessionOf("cc-1", "claude-code", "/home/dev/notes", "2026-09-30T23:00:00.000Z", [
  turnOf(0, "2026-09-30T23:30:00.000Z", usage("claude-opus-5-5-20261001", { uncachedInput: k(100), output: k(100) })),
  turnOf(1, "2026-10-01T00:10:00.000Z", usage("claude-opus-5-5-20261001", { uncachedInput: k(100), cacheWrite: k(1000), output: k(100) })),
]);

const fs = new InMemoryFileSystem({ "/home/dev/portal/.git/config": '[remote "origin"]\n\turl = git@github.com:acme/portal.git\n' }, ["/home/dev/notes"]);
const projects = { version: 1, projects: [{ id: "portal", name: "Customer portal", members: [{ repository: "github.com/acme/portal" }] }] };

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
const structured = (result: ToolResult) => result.structuredContent as Record<string, unknown>;

function compose() {
  const vscode = new FakeProvider("vscode", [copilot]);
  const cc = new FakeProvider("claude-code", [claudeCode]);
  const catalog = new ProjectCatalog(new InMemoryProjectStore(JSON.stringify(projects)));
  const attributor = new SessionAttributor({
    repositories: new RepositoryResolver(fs),
    projects: catalog,
    vendors: new ProfileVendorResolver([{ vendorId: "anthropic", displayName: "Anthropic", models: [{ modelId: "claude-sonnet-5.5" }, { modelId: "claude-opus-5.5" }] }]),
    homeDir: "/home/dev",
  });
  const pricer = createTurnPricer(new PriceBook(new BundledPriceBookSource()));
  // The same InsightsService GET /api/insights serves (createInsightsService wires it this way).
  const insights = new InsightsService({ listProviders: () => [vscode, cc] }, [], undefined, attributor, pricer);
  const providers = lookup(vscode, cc);
  return {
    insights,
    server: createMcpServer({
      auditQueries: new AuditQueryService(providers),
      analysisQueries: new AnalysisQueryService(providers, insights, { attribution: attributor, pricer }),
      getProviderStatus: async () => providerStatus,
      version: "0.0.0-test",
    }),
  };
}

describe("MCP cost basis (step 15.6)", () => {
  it("puts no local folder path in any of the three tools' output (§10.1.5)", async () => {
    const composed = compose();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const local = new Client({ name: "privacy", version: "1.0.0" });
    await Promise.all([composed.server.connect(serverTransport), local.connect(clientTransport)]);
    const outputs = await Promise.all([
      local.callTool({ name: "get_cost_rollup", arguments: {} }),
      local.callTool({ name: "get_session_cost", arguments: { sessionId: "cc-1", provider: "claude-code" } }),
      local.callTool({ name: "get_turn", arguments: { sessionId: "cc-1", turnIndex: 1, provider: "claude-code" } }),
    ]);
    for (const output of outputs) expect(JSON.stringify(output)).not.toContain("/home/dev");
    await local.close();
  });

  let client: Client;
  let insights: InsightsService;

  beforeEach(async () => {
    const composed = compose();
    insights = composed.insights;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([composed.server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
  });

  it("documents the cost basis in the three tools and adds the rollup's repository and project filters", async () => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    for (const name of ["get_session_cost", "get_cost_rollup", "get_turn"]) {
      expect(byName.get(name)?.description, name).toMatch(/billed.*reported.*priced/i);
      expect(byName.get(name)?.annotations?.readOnlyHint, name).toBe(true);
    }
    expect(byName.get("get_cost_rollup")?.description).toContain("1 AI Credit = $0.01");
    expect(Object.keys(byName.get("get_cost_rollup")?.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(["repository", "projectId"]));
  });

  describe("get_session_cost", () => {
    it("adds the repository, project and per-basis cost with coverage and price versions", async () => {
      const cost = sessionCostSchema.parse(structured(await client.callTool({ name: "get_session_cost", arguments: { sessionId: "copilot-1", provider: "vscode" } })));
      expect(cost).toMatchObject({ repositoryKey: "github.com/acme/portal", projectId: "portal" });
      expect(cost.cost.billed).toMatchObject({ turns: 2, knownTurns: 2, amounts: [{ currency: "AI_CREDITS", amount: 1.4, knownTurns: 2 }] });
      expect(cost.cost.priced).toMatchObject({ turns: 2, knownTurns: 1 });
      expect(cost.cost.priced.amounts[0]?.amount).toBeCloseTo(0.79);
      expect(cost.cost.priceVersionIds).toEqual(["github-copilot:claude-sonnet-5.5:2026-10-07"]);
      // The existing AI Credits figures are unchanged.
      expect(cost.totals.aiCredits).toMatchObject({ value: 1.4, knownTurns: 2, turns: 2 });
    });

    it("labels Claude Code's priced figures API-equivalent and keeps a pre-price-book turn unknown, not 0", async () => {
      const cost = sessionCostSchema.parse(structured(await client.callTool({ name: "get_session_cost", arguments: { sessionId: "cc-1", provider: "claude-code" } })));
      // A folder-path key is given as the folder's name only (§10.1.5).
      expect(cost).toMatchObject({ repositoryKey: "path:notes", projectId: null });
      expect(cost.cost.priced).toMatchObject({ turns: 2, knownTurns: 1, apiEquivalentTurns: 1 });
      expect(cost.cost.priced.usd).toBeCloseTo(0.0104);
      expect(cost.cost.preferredBasisTurns).toEqual({ billed: 0, reported: 0, priced: 1, unknown: 1 });
      const early = cost.topTurns.find((t) => t.turnIndex === 0)!;
      expect(early.cost.priced).toEqual({ known: false, reason: "Cannot price: no price for claude-opus-5.5 on anthropic-api before 2026-10-01" });
    });

    it("agrees with the session row of the dataset GET /api/insights serves", async () => {
      const dataset = await insights.getDataset({});
      const cost = sessionCostSchema.parse(structured(await client.callTool({ name: "get_session_cost", arguments: { sessionId: "copilot-1", provider: "vscode" } })));
      expect(cost.cost).toEqual(dataset.sessions.find((row) => row.sessionId === "copilot-1")?.cost);
    });
  });

  describe("get_turn", () => {
    it("adds the turn's three figures, the price version and the preferred one", async () => {
      const view = turnViewSchema.parse(structured(await client.callTool({ name: "get_turn", arguments: { sessionId: "cc-1", turnIndex: 1, provider: "claude-code" } })));
      expect(view.cost.billed.known).toBe(false);
      expect(view.cost.reported).toEqual({ known: false, reason: "This provider logs no cost of its own." });
      expect(view.cost.priced).toMatchObject({
        known: true,
        currency: "USD",
        basis: "priced",
        priceVersionIds: ["anthropic-api:claude-opus-5.5:2026-10-01"],
        apiEquivalent: true,
      });
      expect(view.cost.priced.known && view.cost.priced.notes?.[0]).toMatch(/1-hour/);
      expect(view.preferredCost).toEqual(view.cost.priced);
    });

    it("prefers the billed figure on a Copilot turn, and agrees with the dataset's turn row", async () => {
      const view = turnViewSchema.parse(structured(await client.callTool({ name: "get_turn", arguments: { sessionId: "copilot-1", turnIndex: 0, provider: "vscode" } })));
      expect(view.preferredCost).toEqual({ known: true, amount: 0.9, currency: "AI_CREDITS", basis: "billed" });
      const dataset = await insights.getDataset({});
      expect(view.cost).toEqual(dataset.turns.find((row) => row.key === "vscode:copilot-1:0")?.cost);
    });
  });

  describe("get_cost_rollup", () => {
    it("totals each basis with coverage across providers, never summing unknown as 0", async () => {
      const rollup = costRollupSchema.parse(structured(await client.callTool({ name: "get_cost_rollup", arguments: {} })));
      expect(rollup.cost.preferred).toMatchObject({ turns: 4, knownTurns: 3 });
      expect(rollup.cost.preferred.amounts.map((a) => [a.currency, a.knownTurns])).toEqual([
        ["AI_CREDITS", 2],
        ["USD", 1],
      ]);
      expect(rollup.cost.preferred.usd).toBeCloseTo(0.014 + 0.0104);
      expect(rollup.cost.conversion).toContain("1 AI Credit = $0.01");
    });

    it("breaks cost down by repository, project, vendor and channel", async () => {
      const rollup = costRollupSchema.parse(structured(await client.callTool({ name: "get_cost_rollup", arguments: {} })));
      expect(rollup.byRepository.map((g) => [g.key, g.turns])).toEqual([
        ["github.com/acme/portal", 2],
        ["path:notes", 2],
      ]);
      expect(rollup.byProject.map((g) => [g.key, g.label])).toEqual([
        ["portal", "Customer portal"],
        [null, "No project"],
      ]);
      expect(rollup.byChannel.map((g) => g.key)).toEqual(["github-copilot", "anthropic-api"]);
      expect(rollup.byVendor.map((g) => [g.key, g.turns])).toEqual([["anthropic", 4]]);
    });

    it("reconciles billed and priced AI Credits for Copilot turns per model and month", async () => {
      const rollup = costRollupSchema.parse(structured(await client.callTool({ name: "get_cost_rollup", arguments: {} })));
      expect(rollup.reconciliation).toHaveLength(1);
      const [row] = rollup.reconciliation;
      expect(row).toMatchObject({ month: "2026-10", model: "claude-sonnet-5.5", turns: 1, billedAiCredits: 0.9, billedOnlyTurns: 1 });
      expect(row!.pricedAiCredits).toBeCloseTo(0.79);
      expect(row!.difference).toBeCloseTo(0.11);
      expect(row!.priceVersionIds).toEqual(["github-copilot:claude-sonnet-5.5:2026-10-07"]);
    });

    it("filters by repository and project", async () => {
      const byRepository = costRollupSchema.parse(
        structured(await client.callTool({ name: "get_cost_rollup", arguments: { repository: "github.com/acme/portal" } })),
      );
      expect(byRepository).toMatchObject({ sessionCount: 1, turnCount: 2 });
      const byProject = costRollupSchema.parse(structured(await client.callTool({ name: "get_cost_rollup", arguments: { projectId: "portal" } })));
      expect(byProject.topSessions.map((s) => s.sessionId)).toEqual(["copilot-1"]);
    });

    it("filters by a redacted local key as a tool returned it", async () => {
      const rollup = costRollupSchema.parse(structured(await client.callTool({ name: "get_cost_rollup", arguments: { repository: "path:notes" } })));
      expect(rollup.topSessions.map((s) => s.sessionId)).toEqual(["cc-1"]);
    });

    it("agrees with the turns of the dataset GET /api/insights serves", async () => {
      const dataset = await insights.getDataset({});
      const rollup = costRollupSchema.parse(structured(await client.callTool({ name: "get_cost_rollup", arguments: {} })));
      expect(rollup.cost).toEqual(costBasisTotals(dataset.turns.map((row) => row.cost!)));
    });

    it("parses when every figure is unknown", async () => {
      const rollup = costRollupSchema.parse(
        structured(await client.callTool({ name: "get_cost_rollup", arguments: { since: "2026-09-30", until: "2026-09-30" } })),
      );
      expect(rollup.turnCount).toBe(2);
      expect(rollup.cost.priced).toMatchObject({ turns: 2, knownTurns: 1 });
      const none = costRollupSchema.parse(structured(await client.callTool({ name: "get_cost_rollup", arguments: { projectId: "nothing" } })));
      expect(none.cost.preferred).toEqual({ turns: 0, knownTurns: 0, amounts: [], usd: null, estimated: false, apiEquivalentTurns: 0 });
    });
  });
});
