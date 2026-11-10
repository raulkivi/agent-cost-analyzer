// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The view's only gateway to the host (MCP Apps plan §4.3, DIP): components
// and view code depend on this port, never on ext-apps. The adapter wraps
// ext-apps' App; tests use FakeAppHostPort.

export type DisplayMode = "inline" | "fullscreen" | "pip";

// The slice of the host context the views use. Hosts send any subset, and
// VS Code sends toolCall.toolName where Claude Desktop sends toolInfo.
export interface HostContext {
  toolInfo?: { tool: { name: string } };
  toolCall?: { toolName: string };
  theme?: "light" | "dark";
  displayMode?: DisplayMode;
  availableDisplayModes?: DisplayMode[];
  // The host's look (MCP Apps spec): CSS variables by name, and @font-face
  // rules for its fonts. Hosts send any subset (plan §5.2).
  styles?: { variables?: Record<string, string | undefined>; css?: { fonts?: string } };
}

export interface ToolResult {
  structuredContent?: unknown;
  isError?: boolean;
  // The first text of an error result (e.g. 'Unknown project id "x"…'). Plain
  // text for display; never sent on to the model (plan §6).
  errorText?: string;
}

export type Unsubscribe = () => void;

export interface AppHostPort {
  connect(): Promise<void>;
  // Drill-downs call tools the model can already call (plan §4.5).
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  // False when the host declined; a missing capability hides the affordance.
  openLink(url: string): Promise<boolean>;
  // Fixed templates naming ids only; never logged text (plan §4.3).
  sendMessage(text: string): Promise<boolean>;
  requestDisplayMode(mode: DisplayMode): Promise<DisplayMode>;
  // Listeners are called with the latest value at once if one has arrived.
  onHostContext(listener: (context: HostContext) => void): Unsubscribe;
  onToolInput(listener: (args: Record<string, unknown>) => void): Unsubscribe;
  onToolResult(listener: (result: ToolResult) => void): Unsubscribe;
}
