// Every named operation the UI performs against its backend. Mirrors the
// domain package's `ApiMethod` (shared with the extension host's request
// allow-list) and will be replaced by it once that lands.
export type ApiMethodName =
  | "listSessions"
  | "getSession"
  | "getTurnDetail"
  | "getSystemPromptText"
  | "getConfigStatus"
  | "setRetentionThreshold"
  | "listLearnScenarios"
  | "getLearnScenario"
  | "getLogProviderStatus"
  | "setActiveLogProvider"
  | "getSessionAudit"
  | "listToolCalls"
  | "getAuditRollup"
  | "getInsights"
  | "getHealth"
  | "getProductProfile";

// Port between api-client and whatever carries requests to the backend: HTTP
// to the standalone server, or postMessage to the VS Code extension host.
// `params` is an object whose keys are documented per method in
// http-transport.ts; getSystemPromptText resolves to a string, every other
// method to its JSON result.
export interface ApiTransport {
  call<T>(method: ApiMethodName, params?: unknown): Promise<T>;
}
