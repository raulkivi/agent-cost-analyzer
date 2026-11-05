import type { LogProviderRegistry } from "../data-sources/log-providers/registry.js";
import type { McpIdentity } from "../mcp/mcp-identity.js";
import type { McpServerDeps } from "../mcp/mcp-server.js";
import { AnalysisQueryService } from "../services/analysis/analysis-query-service.js";
import type { AttributionQueries } from "../services/cost-attribution/attribution-query-service.js";
import type { DatasetAttribution } from "../services/insights/insights-service.js";
import { AuditQueryService } from "../services/tool-audit/audit-query-service.js";
import { createInsightsService } from "./create-insights-service.js";

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

export function createMcpServices(
  registry: LogProviderRegistry,
  version: string,
  identity?: McpIdentity,
  attribution?: McpAttributionServices,
): McpServerDeps {
  return {
    auditQueries: new AuditQueryService(registry),
    analysisQueries: new AnalysisQueryService(registry, createInsightsService(registry, attribution?.dataset)),
    getProviderStatus: () => registry.getStatus(),
    version,
    ...(identity ? { identity } : {}),
    ...(attribution ? { attribution: attribution.queries } : {}),
  };
}
