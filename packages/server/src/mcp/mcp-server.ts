// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { McpServer } from "@modelcontextprotocol/server";
import type { LogProviderStatus } from "@agent-cost-analyzer/domain";
import type { AnalysisQueryService } from "../services/analysis/analysis-query-service.js";
import type { PriceBookReader } from "../services/pricing/price-book.js";
import type { AttributionQueries } from "../services/cost-attribution/attribution-query-service.js";
import type { AuditQueryService } from "../services/tool-audit/audit-query-service.js";
import type { CostAnalysisQueries } from "../services/cost-analysis/cost-analysis-service.js";
import { MCP_ICONS, MCP_WEBSITE_URL } from "./mcp-branding.js";
import { STANDALONE_MCP_IDENTITY, type McpIdentity } from "./mcp-identity.js";
import { registerAttributionTools } from "./attribution-tools.js";
import { registerAuditTools } from "./audit-tools.js";
import { registerBillingTools } from "./billing-tools.js";
import type { StatementQueries } from "../services/billing/statement-service.js";
import type { EstimateQueries } from "../services/billing/estimate-service.js";
import { registerCostAnalysisTools, registerCostTools } from "./cost-tools.js";
import { registerFindingTools } from "./finding-tools.js";
import { registerPricingTools } from "./pricing-tools.js";
import { registerPrompts } from "./prompts.js";
import { registerReplayTools } from "./replay-tools.js";
import type { SessionReplayQueries } from "../services/session-replay/session-replay-service.js";
import { registerSessionTools } from "./session-tools.js";
import { createGuard } from "./tool-helpers.js";
import { captureRegisteredTools, registerAppViews } from "./apps/register-app-views.js";
import type { ViewSource } from "./apps/view-source.js";

// Local, read-only MCP interface over the analyzer (docs/plans/
// tool-call-audit.md §10, docs/plans/mcp-tools-v2.md) so a user can attach
// it to Claude Code or any MCP-capable harness and query their own
// sessions. Transport-agnostic: stdio.ts serves it over stdio; tests
// connect it in memory. Each tool group registers itself (open/closed).
// createMcpServer is serveStdio's factory, called once per connection and
// once more per server/discover probe, so it only builds a server over the
// deps it is given: no I/O, no output, no service calls.

export interface McpServerDeps {
  // threat-model.md §5.6: whether list_projects returns each project's client
  // name and billing code to the chat model. Off unless the user launches the
  // server with --project-billing-details; statements (get_statement) always
  // carry them, since a statement is for the client.
  projectBillingDetails?: boolean;
  auditQueries: AuditQueryService;
  analysisQueries: AnalysisQueryService;
  getProviderStatus: () => Promise<LogProviderStatus>;
  // Phase 15 step 15.5: get_price_book is registered only with a price book
  // (the standalone server; the extension's gets one in step 15.13).
  priceBook?: PriceBookReader;
  // Phase 15 step 15.4: repositories and projects (list_repositories,
  // list_projects, list_sessions' repository/project filters). Absent for a
  // product without a projects file yet (the extension, until step 15.14).
  attribution?: AttributionQueries;
  // Phase 15 step 15.7: get_repository_cost, get_project_cost and
  // compare_costs. Absent for a product without them yet (the extension,
  // until step 15.13).
  costAnalysis?: CostAnalysisQueries;
  // Phase 15 step 15.11: get_statement and prepare_statement (the standalone
  // server; the extension's with step 15.13).
  statements?: StatementQueries;
  // Phase 15 step 15.12: estimate_cost and estimate_work.
  estimates?: EstimateQueries;
  // Phase 14 step 14.5 (D5, D7): replay_session and
  // compare_models_for_session, in both products, where a price book exists.
  sessionReplay?: SessionReplayQueries;
  version: string;
  // Phase 12 (docs/plans/mcp-apps.md §4.2): the MCP App views. When given,
  // the server serves the views resource, the app-only get_turn_series and
  // names the view on the tools that have one; absent, nothing changes.
  appViews?: { source: ViewSource };
  // Phase 15 step 15.13 (plan §10.1.4): the tool groups this product serves,
  // every group when omitted. A group is registered only when its services
  // are given too. The extension leaves out billing (D7).
  toolGroups?: readonly McpToolGroup[];
  // The name and log-source wording of the product serving the tools;
  // defaults to the standalone server's (mcp-identity.ts).
  identity?: McpIdentity;
}

// The tool groups, one module each (open/closed): sessions, audit and cost
// (session_cost, cost_rollup) and findings are Phase 9.12's; the rest come
// with Phase 15 and need their services; replay comes with Phase 14.
export const MCP_TOOL_GROUPS = ["sessions", "audit", "cost", "findings", "attribution", "pricing", "costAnalysis", "replay", "billing"] as const;
export type McpToolGroup = (typeof MCP_TOOL_GROUPS)[number];
// The extension's set: billing and estimates are standalone-only (D7).
export const WITHOUT_BILLING_TOOL_GROUPS: readonly McpToolGroup[] = MCP_TOOL_GROUPS.filter((group) => group !== "billing");

// Kept for the standalone server's callers; the wording lives in the identity.
export const SERVER_INSTRUCTIONS = STANDALONE_MCP_IDENTITY.instructions;

// SDK 2.3.0's guard on a tools/call's arguments (array elements plus object
// members, counted before validation). The largest legitimate argument is
// list_tool_calls with every filter value once: 38 (compare_costs with 20
// ids: 30). 256 leaves more than six times that and still bounds the work
// a pathological call causes, such as an enum filter repeated thousands of
// times, which the schemas allow. A call over it is answered with an
// isError result naming the limit (mcp-protocol.test.ts pins both).
export const MAX_TOOL_INPUT_ELEMENTS = 256;

// What the tool groups see: the deps with the identity resolved.
export type McpToolDeps = McpServerDeps & { identity: McpIdentity };

export function createMcpServer(deps: McpServerDeps): McpServer {
  const identity = deps.identity ?? STANDALONE_MCP_IDENTITY;
  const toolDeps: McpToolDeps = { ...deps, identity };
  const server = new McpServer(
    {
      name: identity.name,
      title: identity.title,
      description: identity.description,
      version: deps.version,
      websiteUrl: MCP_WEBSITE_URL,
      icons: MCP_ICONS,
    },
    // No cache hints (D4, docs/plans/mcp-sdk-2-migration.md §6): SDK 2 answers
    // 2026-07-28 requests with ttlMs 0, so a host never keeps the views file
    // past an update.
    { instructions: identity.instructions, maxToolInputElements: MAX_TOOL_INPUT_ELEMENTS },
  );
  const guarded = createGuard(deps.getProviderStatus);

  // Recorded so the views group can name its resource on the tools above.
  const registered = deps.appViews ? captureRegisteredTools(server) : undefined;

  const serves = (group: McpToolGroup) => (deps.toolGroups ?? MCP_TOOL_GROUPS).includes(group);
  const costAnalysis = serves("costAnalysis") ? deps.costAnalysis : undefined;
  const statements = serves("billing") ? deps.statements : undefined;
  const estimates = serves("billing") ? deps.estimates : undefined;

  if (serves("sessions")) registerSessionTools(server, toolDeps, guarded);
  if (serves("audit")) registerAuditTools(server, toolDeps, guarded);
  if (serves("cost")) registerCostTools(server, toolDeps, guarded);
  if (costAnalysis) registerCostAnalysisTools(server, toolDeps, costAnalysis, guarded, deps.attribution);
  if (serves("findings")) registerFindingTools(server, toolDeps, guarded);
  if (serves("pricing") && deps.priceBook) registerPricingTools(server, deps.priceBook, guarded, deps.costAnalysis);
  if (serves("attribution") && deps.attribution) registerAttributionTools(server, toolDeps, deps.attribution, guarded);
  if (serves("replay") && deps.sessionReplay) registerReplayTools(server, toolDeps, deps.sessionReplay, guarded);
  if (statements || estimates) registerBillingTools(server, { statements, estimates }, guarded);
  if (deps.appViews && registered) {
    registerAppViews(server, { identity, version: deps.version, source: deps.appViews.source, analysisQueries: deps.analysisQueries }, registered, guarded);
  }
  registerPrompts(server, { costAnalysis: costAnalysis !== undefined, statements: statements !== undefined, estimates: estimates !== undefined });

  return server;
}
