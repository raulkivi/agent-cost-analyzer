import type { McpStdioServerSpec } from "../mcp/mcp-server-definitions.js";
import type { TimingMark } from "../performance/performance-recorder.js";
import type { SessionsTreeNode } from "../sidebar/sessions-tree-model.js";
import type { RpcTraceEntry } from "./rpc-trace.js";

// Commands for step 10.9's integration tests (src/test/integration/), which
// run in a real VS Code and can't see inside the extension otherwise.
// extension.ts registers them only when VS Code runs the extension in
// ExtensionMode.Test (the Extension Development Host @vscode/test-electron
// starts), and package.json never contributes them, so an installed copy
// has none: nothing for users to see in the Command Palette, and nothing
// for other extensions to call. A command, rather than an API returned from
// activate(), for that reason: an exported API would exist in every
// installed copy.
export const INTERNAL_COMMAND_IDS = {
  // The recorded timing marks (performance/performance-recorder.ts).
  perfMarks: "aiCreditsAnalyzer.internal.perfMarks",
  // The webview's answered requests (diagnostics/rpc-trace.ts).
  rpcTrace: "aiCreditsAnalyzer.internal.rpcTrace",
  // The Sessions view's nodes, as its tree data provider returns them.
  sessionsTree: "aiCreditsAnalyzer.internal.sessionsTree",
  // What the MCP server definition provider offers VS Code right now.
  mcpServerDefinitions: "aiCreditsAnalyzer.internal.mcpServerDefinitions",
  // Forgets the marks and the trace, so a test reads only its own.
  resetDiagnostics: "aiCreditsAnalyzer.internal.resetDiagnostics",
} as const;

export interface TestHookSources {
  performance: { marks(): TimingMark[]; clear(): void };
  rpcTrace: { entries(): RpcTraceEntry[]; clear(): void };
  sidebar: { sessionsTree(): SessionsTreeNode[] };
  mcpServers: { provide(): McpStdioServerSpec[] };
}

type Handler = (...args: unknown[]) => unknown;

// Every test hook's handler by command id. They only read (or clear the
// diagnostics), and return plain data, which VS Code passes back to the
// test through executeCommand.
export function createTestHookHandlers(sources: TestHookSources): Record<string, Handler> {
  return {
    [INTERNAL_COMMAND_IDS.perfMarks]: () => sources.performance.marks(),
    [INTERNAL_COMMAND_IDS.rpcTrace]: () => sources.rpcTrace.entries(),
    [INTERNAL_COMMAND_IDS.sessionsTree]: () => sources.sidebar.sessionsTree(),
    [INTERNAL_COMMAND_IDS.mcpServerDefinitions]: () => sources.mcpServers.provide(),
    [INTERNAL_COMMAND_IDS.resetDiagnostics]: () => {
      sources.performance.clear();
      sources.rpcTrace.clear();
    },
  };
}
