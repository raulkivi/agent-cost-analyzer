import type { LogProviderRegistry } from "../data-sources/log-providers/registry.js";
import type { McpIdentity } from "../mcp/mcp-identity.js";
import type { McpServerDeps } from "../mcp/mcp-server.js";
import { AnalysisQueryService } from "../services/analysis/analysis-query-service.js";
import { AuditQueryService } from "../services/tool-audit/audit-query-service.js";
import { createInsightsService } from "./create-insights-service.js";

// The services createMcpServer takes, over whichever registry a product's
// composition root built: every provider for the standalone stdio server
// (mcp/stdio.ts), the Copilot provider only for the extension's
// (create-copilot-mcp-services.ts). One wiring, so the two servers answer
// the same tools the same way and differ only in the data behind them
// and the identity's wording (vscode-extension.md D7). It imports no provider itself.
export function createMcpServices(registry: LogProviderRegistry, version: string, identity?: McpIdentity): McpServerDeps {
  return {
    auditQueries: new AuditQueryService(registry),
    analysisQueries: new AnalysisQueryService(registry, createInsightsService(registry)),
    getProviderStatus: () => registry.getStatus(),
    version,
    ...(identity ? { identity } : {}),
  };
}
