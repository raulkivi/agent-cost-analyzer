import type { LogProviderRegistry } from "../data-sources/log-providers/registry.js";
import type { McpIdentity } from "../mcp/mcp-identity.js";
import type { McpServerDeps } from "../mcp/mcp-server.js";
import { AnalysisQueryService } from "../services/analysis/analysis-query-service.js";
import type { AttributionQueries } from "../services/cost-attribution/attribution-query-service.js";
import type { DatasetAttribution } from "../services/insights/insights-service.js";
import { AuditQueryService } from "../services/tool-audit/audit-query-service.js";
import { createInsightsService } from "./create-insights-service.js";
import type { TurnPricing } from "../services/pricing/turn-cost-figures.js";
import type { PriceVersionSource } from "../services/cost-analysis/cost-analysis-service.js";
import { createCostAnalysis } from "./create-cost-analysis.js";
import { DatasetCostCubeSource } from "../services/cost-analysis/cost-analysis-service.js";
import { StatementService, type StatementServiceDeps } from "../services/billing/statement-service.js";
import { EstimateService } from "../services/billing/estimate-service.js";
import type { StatementStore } from "../services/billing/statement-store.js";
import type { VendorProfile } from "@agent-cost-analyzer/domain";
import type { PriceBook } from "../services/pricing/price-book.js";
import { ReplayModelResolver } from "../services/session-replay/replay-model-resolver.js";
import { createSessionReplay } from "./create-session-replay.js";

// The services createMcpServer takes, over whichever registry a product's
// composition root built: every provider for the standalone stdio server
// (mcp/stdio.ts), the Copilot provider only for the extension's
// (create-copilot-mcp-services.ts). One wiring, so the two servers answer
// the same tools the same way and differ only in the data behind them
// and the identity's wording (vscode-extension.md D7). It imports no provider itself.
// Step 15.4: the standalone server adds attribution (its projects file);
// the extension's has none until step 15.14.
export interface McpAttributionServices {
  queries: AttributionQueries;
  dataset: DatasetAttribution;
}

export interface McpStatementInputs {
  store: StatementStore;
  projects: StatementServiceDeps["projects"];
  priceBookHash: () => string;
  timeZone?: string;
}

// Phase 14 step 14.5 (D5, D7): what replays run on. Both products pass it
// when they have a price book; without one the replay group isn't served.
export interface McpReplayInputs {
  profiles: readonly VendorProfile[];
  priceBook: PriceBook;
}

export function createMcpServices(
  registry: LogProviderRegistry,
  version: string,
  identity?: McpIdentity,
  attribution?: McpAttributionServices,
  // Step 15.6: the priced cost basis (createTurnPricer); absent, priced
  // figures are unknown with the reason.
  pricer?: TurnPricing,
  // Step 15.7: the price book's versions, for price-change markers in the
  // cost analyses (which come with attribution: they need projects).
  priceVersions?: PriceVersionSource,
  // Step 15.11: issued statements and what drafts need (with attribution).
  statements?: McpStatementInputs,
  // Step 14.5: replay_session, compare_models_for_session and
  // estimate_cost's model (needs the turn pricer too, for measured figures).
  replay?: McpReplayInputs,
): McpServerDeps {
  const insights = createInsightsService(registry, attribution?.dataset, pricer);
  const sessionReplay =
    replay && pricer
      ? createSessionReplay({ providers: registry, profiles: replay.profiles, priceBook: replay.priceBook, pricer, ...(attribution ? { attribution: attribution.dataset } : {}) })
      : undefined;
  return {
    auditQueries: new AuditQueryService(registry),
    analysisQueries: new AnalysisQueryService(registry, insights, {
      ...(attribution ? { attribution: attribution.dataset } : {}),
      ...(pricer ? { pricer } : {}),
    }),
    getProviderStatus: () => registry.getStatus(),
    version,
    ...(identity ? { identity } : {}),
    ...(sessionReplay ? { sessionReplay } : {}),
    ...(attribution ? { attribution: attribution.queries } : {}),
    ...(attribution
      ? {
          costAnalysis: createCostAnalysis(insights, priceVersions, {
            projectName: (id) => attribution.queries.listProjects().projects.find((project) => project.id === id)?.name,
          }),
        }
      : {}),
    ...(attribution && statements
      ? {
          statements: new StatementService({
            cubes: new DatasetCostCubeSource(insights),
            store: statements.store,
            projects: statements.projects,
            priceBookHash: statements.priceBookHash,
            appVersion: version,
            timeZone: statements.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
          // Step 15.12: estimates come with statements (the billing group).
          estimates: new EstimateService({
            cubes: new DatasetCostCubeSource(insights),
            projects: { projectName: (id) => attribution.queries.listProjects().projects.find((project) => project.id === id)?.name },
            ...(sessionReplay && replay ? { replay: { sessions: sessionReplay, models: new ReplayModelResolver(replay.profiles) } } : {}),
          }),
        }
      : {}),
  };
}
