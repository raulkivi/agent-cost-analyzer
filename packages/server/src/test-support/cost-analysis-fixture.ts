// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { DatasetCostCubeSource } from "../services/cost-analysis/cost-analysis-service.js";
import { priceBookHashOf, StatementService } from "../services/billing/statement-service.js";
import { InMemoryStatementStore } from "./in-memory-statement-store.js";
import { EstimateService } from "../services/billing/estimate-service.js";
import type { LogProviderStatus, RequestTrace, Session, TokenCount, Turn, TurnUsage } from "@agent-cost-analyzer/domain";
import type { RequestTraceReader } from "../data-sources/log-providers/log-provider.js";
import { loadVendorProfiles } from "../data-sources/vendor-profiles/loader.js";
import { createSessionReplay } from "../composition/create-session-replay.js";
import { ReplayModelResolver } from "../services/session-replay/replay-model-resolver.js";
import { FIXTURE_VENDOR_PROFILES_DIR } from "./vendor-profiles-dir.js";
import { createCostAnalysis, projectDirectoryOf } from "../composition/create-cost-analysis.js";
import { createTurnPricer } from "../composition/create-turn-pricer.js";
import { UnknownLogProviderIdError } from "../data-sources/log-providers/registry.js";
import { createMcpServer, type McpServerDeps } from "../mcp/mcp-server.js";
import { AttributionQueryService } from "../services/cost-attribution/attribution-query-service.js";
import { RepositoryListService } from "../services/cost-attribution/repository-list-service.js";
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

// Phase 14 step 14.5: Claude Code and Copilot sessions can be replayed (D1),
// each turn one request with the turn's own token counts; pi can't.
function traceOf(providerId: string, harness: RequestTrace["harness"], session: Session): RequestTrace {
  const value = (count: TokenCount) => (count.known ? count.value : null);
  return {
    sessionId: session.id,
    providerId,
    harness,
    requests: session.turns.map((turn, index) => ({
      index,
      turnIndex: turn.index,
      startedAt: turn.startedAt!,
      model: turn.usage.model,
      uncachedInput: value(turn.usage.uncachedInput) ?? 0,
      cacheRead: value(turn.usage.cacheRead) ?? 0,
      cacheWrite: value(turn.usage.cacheWrite),
      output: value(turn.usage.output) ?? 0,
    })),
    notTraced: [],
  };
}

class TracedFakeProvider extends FakeProvider implements RequestTraceReader {
  constructor(
    id: string,
    private readonly traced: Session[],
    private readonly harness: RequestTrace["harness"],
  ) {
    super(id, traced);
  }
  async readRequestTrace(sessionId: string): Promise<RequestTrace | null> {
    const session = this.traced.find((candidate) => candidate.id === sessionId);
    return session ? traceOf(this.id, this.harness, session) : null;
  }
}

const FIXTURE_HOME = "/home/dev";

// Step 15.13: the security tests move the fixture to another home folder
// and give portal-api's remote a credential.
function filesAt(home: string, portalApiRemote = "https://github.com/acme/portal-api.git") {
  return new InMemoryFileSystem(
    {
      [`${home}/portal-web/.git/config`]: '[remote "origin"]\n\turl = git@github.com:acme/portal-web.git\n',
      [`${home}/portal-api/.git/config`]: `[remote "origin"]\n\turl = ${portalApiRemote}\n`,
      [`${home}/billing/.git/config`]: '[remote "origin"]\n\turl = git@github.com:acme/billing.git\n',
      [`${home}/scratch/.git/config`]: "[core]\n\tbare = false\n",
    },
    [`${home}/notes`],
  );
}

function rehome(sessions: Session[], home: string): Session[] {
  if (home === FIXTURE_HOME) return sessions;
  return sessions.map((session) =>
    session.workspace?.known ? { ...session, workspace: { known: true, cwd: home + session.workspace.cwd.slice(FIXTURE_HOME.length) } } : session,
  );
}

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

export type CostFixtureOptions = Pick<McpServerDeps, "toolGroups" | "identity" | "projectBillingDetails" | "appViews"> & {
  // Step 15.13: the security tests' generated home folder, remote and projects.
  home?: string;
  portalApiRemote?: string;
  projects?: unknown;
};

export function composeCostFixture({ home = FIXTURE_HOME, portalApiRemote, projects = fixtureProjects, ...options }: CostFixtureOptions = {}) {
  const providers = [
    new TracedFakeProvider("vscode", rehome(copilotSessions, home), "vscode-local"),
    new TracedFakeProvider("claude-code", rehome(claudeCodeSessions, home), "claude-code"),
    new FakeProvider("pi-agent", rehome(piSessions, home)),
  ];
  const lookup: ProviderLookup = {
    getActiveProvider: () => providers[0]!,
    getProvider: (id) => {
      const found = providers.find((provider) => provider.id === id);
      if (!found) throw new UnknownLogProviderIdError(id);
      return found;
    },
  };
  const catalog = new ProjectCatalog(new InMemoryProjectStore(JSON.stringify(projects)));
  const attributor = new SessionAttributor({
    repositories: new RepositoryResolver(filesAt(home, portalApiRemote)),
    projects: catalog,
    vendors: new ProfileVendorResolver(vendorProfiles),
    homeDir: home,
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
  // Phase 14 step 14.5: replays as both products wire them (createSessionReplay).
  const profiles = loadVendorProfiles(FIXTURE_VENDOR_PROFILES_DIR);
  const sessionReplay = createSessionReplay({ providers: lookup, profiles, priceBook, pricer, attribution: attributor });
  const estimates = new EstimateService({
    cubes: new DatasetCostCubeSource(insights),
    projects: projectDirectoryOf(catalog),
    now: () => FIXTURE_NOW,
    replay: { sessions: sessionReplay, models: new ReplayModelResolver(profiles) },
  });
  // The cost routes read only costAnalysis, statements and estimates (app.ts passes req.query unchanged).
  const api = new ApiService({ costAnalysis, statements, estimates } as unknown as ApiServiceDeps);
  const deps: McpServerDeps = {
    auditQueries: new AuditQueryService(lookup),
    analysisQueries: new AnalysisQueryService(lookup, insights, { attribution: attributor, pricer }),
    getProviderStatus: async () => providerStatus,
    version: "0.0.0-test",
    // Step 15.13: every Phase 15 group, as the standalone stdio server has them.
    attribution: new AttributionQueryService(new RepositoryListService({ listProviders: () => providers }, attributor), catalog, attributor),
    costAnalysis,
    priceBook,
    statements,
    estimates,
    sessionReplay,
    ...options,
  };
  const server = createMcpServer(deps);
  return { api, server, deps, insights, costAnalysis, statements, sessionReplay };
}

export async function connectCostFixture(options: CostFixtureOptions = {}): Promise<{ client: Client; api: ApiService }> {
  const { server, api } = composeCostFixture(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, api };
}
