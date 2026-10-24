import type { ApiMethod } from "@copilot-cost-analyzer/domain";

// Every named operation the UI performs against its backend: the domain's
// shared `ApiMethod` names, which the extension host's request allow-list
// also uses.
export type ApiMethodName = ApiMethod;

// Port between api-client and whatever carries requests to the backend: HTTP
// to the standalone server, or postMessage to the VS Code extension host.
// `params` is an object whose keys are documented per method in
// http-transport.ts; getSystemPromptText resolves to a string, every other
// method to its JSON result.
export interface ApiTransport {
  call<T>(method: ApiMethodName, params?: unknown): Promise<T>;
}
