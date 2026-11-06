import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { DatasetCostCubeSource } from "../services/cost-analysis/cost-analysis-service.js";
import { priceBookHashOf, StatementService } from "../services/billing/statement-service.js";
import { InMemoryStatementStore } from "./in-memory-statement-store.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { LogProviderStatus, Session, TokenCount, Turn, TurnUsage } from "@agent-cost-analyzer/domain";
import { createCostAnalysis, projectDirectoryOf } from "../composition/create-cost-analysis.js";
import { createTurnPricer } from "../composition/create-turn-pricer.js";
import { UnknownLogProviderIdError } from "../data-sources/log-providers/registry.js";
import { createMcpServer } from "../mcp/mcp-server.js";
import { AnalysisQueryService } from "../services/analysis/analysis-query-service.js";
import { ApiService, type ApiServiceDeps } from "../services/api/api-service.js";
import { ProjectCatalog } from "../services/cost-attribution/project-catalog.js";
import { RepositoryResolver } from "../services/cost-attribution/repository-resolver.js";
import { SessionAttributor } from "../services/cost-attribution/session-attributor.js";
import { ProfileVendorResolver } from "../services/cost-attribution/vendor-resolver.js";
import { InsightsService } from "../services/insights/insights-service.js";
import { BundledPriceBookSource } from "../services/pricing/bundled-price-book-source.js";
import { PriceBook } from "../services/pricing/price-book.js";
import { AuditQueryService, type ProviderLookup } from "../services/tool-audit/audit-query-service.js";
import { FakeProvider } from "./audit-fakes.js";
import { InMemoryFileSystem } from "./in-memory-file-system.js";
import { InMemoryProjectStore } from "./in-memory-project-store.js";

// Phase 15 step 15.7 (plan §14 row 15.7, §10.1.6): the fixture dataset the
// cost-analysis golden test and the MCP tool tests share. Three providers
// (VS Code/Copilot: billed; Claude Code: priced, API-equivalent; pi:
// reported), two projects over three repositories plus a local repository
// and a folder outside any repository, across Claude Sonnet 5.5's
// 2026-10-07 cache-read cut (a documented price change on both
// github-copilot and anthropic-api) and OpenAI's 2026-10-20 extended
// cache-write price. Turn text is placeholder only. The HTTP side is
// ApiService, which the Express routes call unchanged.

export const FIXTURE_NOW = new Date("2026-11-06T12:00:00.000Z");

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

function sessionOf(id: string, providerId: string, cwd: string, turns: Turn[]): Session {
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
    startedAt: turns[0]!.startedAt!,
    workspace: { known: true, cwd },
  };
}

const PI_COST_LOGGED = (value: number): TokenCount => ({ known: true, value });

// VS Code (Copilot): billed AI Credits; priced on github-copilot.
export const copilotSessions = [
  // Claude Sonnet 5.5 either side of the 2026-10-07 cut: priced 0.88, then 0.79 AI Credits.
  sessionOf("cp-1", "vscode", "/home/dev/portal-web", [
    turnOf(0, "2026-10-06T10:00:00.000Z", usage("claude-sonnet-5.5", { uncachedInput: k(1000), cacheRead: k(9000), output: k(500), costAiCredits: k(1) })),
    turnOf(1, "2026-10-08T10:00:00.000Z", usage("claude-sonnet-5.5", { uncachedInput: k(1000), cacheRead: k(9000), output: k(500), costAiCredits: k(0.9) })),
  ]),
  // GPT-6.1 Sol: billed 2.5, priced 1.4 AI Credits.
  sessionOf("cp-2", "vscode", "/home/dev/billing", [
    turnOf(0, "2026-10-20T09:00:00.000Z", usage("gpt-6.1-sol", { uncachedInput: k(2000), output: k(1000), costAiCredits: k(2.5) })),
  ]),
  // A local repository: nothing billed, cache writes unknown, so nothing is known.
  sessionOf("cp-3", "vscode", "/home/dev/scratch", [
    turnOf(0, "2026-10-25T09:00:00.000Z", usage("gpt-6.1-sol", { uncachedInput: k(500), cacheWrite: u("No trace database."), output: k(50) })),
  ]),
];

// Claude Code: priced on anthropic-api, API-equivalent; writes at the 1-hour rate.
export const claudeCodeSessions = [
  // Before the price book's first price (2026-10-01): unknown, in the comparison period.
  sessionOf("cc-0", "claude-code", "/home/dev/portal-api", [
    turnOf(0, "2026-09-30T23:00:00.000Z", usage("claude-sonnet-5-5-20261001", { uncachedInput: k(100), output: k(100) })),
  ]),
  // $0.0062 (cache write at $4/M), then $0.0023 after the cut.
  sessionOf("cc-1", "claude-code", "/home/dev/portal-api", [
    turnOf(0, "2026-10-05T09:00:00.000Z", usage("claude-sonnet-5-5-20261001", { uncachedInput: k(100), cacheWrite: k(1000), output: k(200) })),
    turnOf(1, "2026-10-09T09:00:00.000Z", usage("claude-sonnet-5-5-20261001", { uncachedInput: k(100), cacheRead: k(1000), output: k(200) })),
  ]),
  // A folder outside any repository: path:notes, no project.
  sessionOf("cc-2", "claude-code", "/home/dev/notes", [
    turnOf(0, "2026-10-12T09:00:00.000Z", usage("claude-opus-5-5-20261001", { uncachedInput: k(100), output: k(100) })),
  ]),
];

// pi: reported USD (Usage.cost); priced on openai-api.
export const piSessions = [
  sessionOf("pi-1", "pi-agent", "/home/dev/billing", [
    turnOf(0, "2026-10-19T15:00:00.000Z", usage("gpt-6.1-sol", { uncachedInput: k(1000), output: k(100), reportedCostUsd: PI_COST_LOGGED(0.05) })),
    // pi logged no cost for this one: the preferred figure is priced ($0.003).
    turnOf(1, "2026-10-21T15:00:00.000Z", usage("gpt-6.1-sol", { uncachedInput: k(1000), output: k(100), reportedCostUsd: u("pi logged no cost") })),
  ]),
];

const files = new InMemoryFileSystem(
  {
    "/home/dev/portal-web/.git/config": '[remote "origin"]\n\turl = git@github.com:acme/portal-web.git\n',
    "/home/dev/portal-api/.git/config": '[remote "origin"]\n\turl = https://github.com/acme/portal-api.git\n',
    "/home/dev/billing/.git/config": '[remote "origin"]\n\turl = git@github.com:acme/billing.git\n',
    "/home/dev/scratch/.git/config": "[core]\n\tbare = false\n",
  },
  ["/home/dev/notes"],
);

export const fixtureProjects = {
  version: 1,
  projects: [
    { id: "portal", name: "Customer portal", client: "Acme Corp", members: [{ repository: "github.com/acme/portal-web" }, { repository: "github.com/acme/portal-api" }] },
    { id: "billing", name: "Billing", members: [{ repository: "github.com/acme/billing" }] },
  ],
};

const vendorProfiles = [
  { vendorId: "anthropic", displayName: "Anthropic", models: [{ modelId: "claude-sonnet-5.5" }, { modelId: "claude-opus-5.5" }] },
  { vendorId: "openai", displayName: "OpenAI", models: [{ modelId: "gpt-6.1-sol" }] },
];

const providerStatus: LogProviderStatus = {
  activeProviderId: "vscode",
  providers: [
    { id: "vscode", label: "VS Code", available: true },
    { id: "claude-code", label: "Claude Code", available: true },
    { id: "pi-agent", label: "pi", available: true },
  ],
};

export function composeCostFixture() {
  const providers = [new FakeProvider("vscode", copilotSessions), new FakeProvider("claude-code", claudeCodeSessions), new FakeProvider("pi-agent", piSessions)];
  const lookup: ProviderLookup = {
    getActiveProvider: () => providers[0]!,
    getProvider: (id) => {
      const found = providers.find((provider) => provider.id === id);
      if (!found) throw new UnknownLogProviderIdError(id);
      return found;
    },
  };
  const catalog = new ProjectCatalog(new InMemoryProjectStore(JSON.stringify(fixtureProjects)));
  const attributor = new SessionAttributor({
    repositories: new RepositoryResolver(files),
    projects: catalog,
    vendors: new ProfileVendorResolver(vendorProfiles),
    homeDir: "/home/dev",
  });
  const priceBook = new PriceBook(new BundledPriceBookSource());
  const pricer = createTurnPricer(priceBook, () => FIXTURE_NOW);
  // The InsightsService GET /api/insights serves (createInsightsService wires it this way, plus detectors).
  const insights = new InsightsService({ listProviders: () => providers }, [], () => FIXTURE_NOW, attributor, pricer);
  const costAnalysis = createCostAnalysis(insights, priceBook, projectDirectoryOf(catalog));
  // Step 15.11: statements over the same dataset, in UTC at the fixed clock.
  const statements = new StatementService({
    cubes: new DatasetCostCubeSource(insights),
    store: new InMemoryStatementStore(),
    projects: catalog,
    priceBookHash: () => priceBookHashOf(priceBook.list({}).versions),
    appVersion: "0.0.0-test",
    timeZone: "UTC",
    now: () => FIXTURE_NOW,
  });
  // The cost routes read only costAnalysis and statements (app.ts passes req.query unchanged).
  const api = new ApiService({ costAnalysis, statements } as unknown as ApiServiceDeps);
  const server = createMcpServer({
    auditQueries: new AuditQueryService(lookup),
    analysisQueries: new AnalysisQueryService(lookup, insights, { attribution: attributor, pricer }),
    getProviderStatus: async () => providerStatus,
    version: "0.0.0-test",
    costAnalysis,
    priceBook,
    statements,
  });
  return { api, server, insights, costAnalysis, statements };
}

export async function connectCostFixture(): Promise<{ client: Client; api: ApiService }> {
  const { server, api } = composeCostFixture();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, api };
}
