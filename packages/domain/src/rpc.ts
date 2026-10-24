import { z } from "zod";

// The ApiService method names (vscode-extension.md D2/§4), shared by the
// server, the web app's transports and the extension's dispatcher so the
// webview RPC's allow-list can't drift from the service. Names only — the
// transports themselves live in their own packages.
export const apiMethodSchema = z.enum([
  "listSessions",
  "getSession",
  "getTurnDetail",
  "getSystemPromptText",
  "getConfigStatus",
  "setRetentionThreshold",
  "listLearnScenarios",
  "getLearnScenario",
  "getLogProviderStatus",
  "setActiveLogProvider",
  "getSessionAudit",
  "listToolCalls",
  "getAuditRollup",
  "getInsights",
  "getHealth",
  "getProductProfile",
]);

export type ApiMethod = z.infer<typeof apiMethodSchema>;
