import { MCP_PROVIDER_ID, type McpStdioServerSpec } from "../mcp/mcp-server-definitions.js";
import type { Disposable } from "../panel/analyzer-panel.js";

// The slice of vscode.McpServerDefinitionProvider the adapter implements,
// over the definition type `D` (vscode.McpStdioServerDefinition in the host).
export interface McpServerDefinitionProviderLike<D> {
  onDidChangeMcpServerDefinitions?(listener: () => void): Disposable;
  provideMcpServerDefinitions(): D[];
}

// The slices of the `vscode` namespace MCP registration needs; extension.ts
// passes the real module, tests a fake.
export interface VscodeMcpApi<D> {
  McpStdioServerDefinition: new (
    label: string,
    command: string,
    args?: string[],
    env?: Record<string, string | number | null>,
    version?: string,
  ) => D;
  lm: { registerMcpServerDefinitionProvider(id: string, provider: McpServerDefinitionProviderLike<D>): Disposable };
}

// What the adapter reads: mcp/mcp-server-definitions.ts's
// McpServerDefinitionSource, which decides.
export interface McpServerDefinitionsSource {
  provide(): McpStdioServerSpec[];
  onDidChange(listener: () => void): Disposable;
}

// Thin adapter (vscode-extension.md D7): registers the contributed
// mcpServerDefinitionProviders id with VS Code, turns each definition the
// source gives into a McpStdioServerDefinition, and passes the source's
// change signal on, so VS Code asks again when the setting flips.
export function registerMcpServerDefinitions<D>(vscode: VscodeMcpApi<D>, source: McpServerDefinitionsSource): Disposable {
  const listeners = new Set<() => void>();
  const sourceSubscription = source.onDidChange(() => {
    for (const listener of [...listeners]) {
      listener();
    }
  });
  const registration = vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, {
    onDidChangeMcpServerDefinitions(listener) {
      listeners.add(listener);
      return { dispose: () => void listeners.delete(listener) };
    },
    provideMcpServerDefinitions: () =>
      source.provide().map((spec) => new vscode.McpStdioServerDefinition(spec.label, spec.command, spec.args, spec.env, spec.version)),
  });
  return {
    dispose: () => {
      registration.dispose();
      sourceSubscription.dispose();
      listeners.clear();
    },
  };
}
