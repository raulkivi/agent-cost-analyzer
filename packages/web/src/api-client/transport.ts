import type { ApiMethod, HostCommand, HostCommandArgs, HostEventName } from "@copilot-cost-analyzer/domain";

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
  // Host-pushed notifications (plan §4); returns the unsubscribe function.
  // Only the webview transport has a host that sends any, so the HTTP
  // transport leaves it out — subscribe through host-events.ts.
  onEvent?(name: HostEventName, handler: (payload: unknown) => void): () => void;
  // Asks the host to act on the editor (domain rpc.ts host commands, G8).
  // Likewise only the webview transport has one; the UI reaches it through
  // the HostCapabilities port (host/host-capabilities.ts), never directly.
  command?<C extends HostCommand>(command: C, args: HostCommandArgs[C]): Promise<void>;
}
