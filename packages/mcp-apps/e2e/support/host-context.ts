// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { McpUiHostContextSchema, type McpUiDisplayMode, type McpUiHostCapabilities, type McpUiHostContext } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { HostSet } from "../../test/theme/host-sets.js";

// The fake host introduces itself as a recorded host did (the A0 spike's
// recordings, docs/plans/mcp-apps-spike-results/): its name, capabilities,
// display modes and the rest of its host context. The theme and style
// variables come from a host set (test/theme/host-sets.ts), so a spec picks
// Claude light or dark, or a VS Code theme, independently of the recording.

export interface HostRecording {
  hostInfo: { name: string; version: string };
  hostCapabilities: Record<string, unknown>;
  toolInfo: { present: boolean };
  displayModes: { current: string; available: string[] };
  otherHostContext: Record<string, unknown> & { toolCall?: { toolCallId?: string; toolName: string } };
}

// Claude Desktop names the tool in toolInfo; VS Code in toolCall, with the
// server's id in front ("<server>-<tool>").
export type ToolNaming = { kind: "toolInfo" } | { kind: "toolCall"; prefix: string };

export interface HostProfile {
  hostInfo: { name: string; version: string };
  capabilities: McpUiHostCapabilities;
  toolNaming: ToolNaming;
  displayMode: McpUiDisplayMode;
  availableDisplayModes: McpUiDisplayMode[];
  // The recorded context the view does not choose: dimensions, locale, platform.
  context: Record<string, unknown>;
}

function toolNamingOf(recording: HostRecording): ToolNaming {
  if (recording.toolInfo.present) return { kind: "toolInfo" };
  const recorded = recording.otherHostContext.toolCall?.toolName;
  const prefix = recorded?.match(/^(.+)-[a-z_]+$/)?.[1];
  if (prefix === undefined) throw new Error("The recording names its tool neither in toolInfo nor as <server>-<tool> in toolCall");
  return { kind: "toolCall", prefix };
}

export function hostProfileFrom(recording: HostRecording): HostProfile {
  // The recorded toolCall named the spike's tool; each view gets its own.
  const context = Object.fromEntries(Object.entries(recording.otherHostContext).filter(([key]) => key !== "toolCall"));
  return {
    hostInfo: recording.hostInfo,
    capabilities: recording.hostCapabilities as McpUiHostCapabilities,
    toolNaming: toolNamingOf(recording),
    displayMode: recording.displayModes.current as McpUiDisplayMode,
    availableDisplayModes: recording.displayModes.available as McpUiDisplayMode[],
    context,
  };
}

export interface ViewPlacement {
  // The tool the model called, as tools/list returned it.
  tool: Tool;
  callId: string;
  width?: number;
  displayMode?: McpUiDisplayMode;
}

export function hostContextFor(profile: HostProfile, set: HostSet, placement: ViewPlacement): McpUiHostContext {
  const displayMode = placement.displayMode ?? profile.displayMode;
  if (!profile.availableDisplayModes.includes(displayMode)) throw new Error(`${profile.hostInfo.name} does not offer ${displayMode}`);
  const recordedDimensions = (profile.context.containerDimensions ?? {}) as Record<string, number>;
  const containerDimensions =
    placement.width === undefined ? recordedDimensions : { ...Object.fromEntries(Object.entries(recordedDimensions).filter(([key]) => key !== "maxWidth")), width: placement.width };
  const toolIdentity =
    profile.toolNaming.kind === "toolInfo"
      ? { toolInfo: { id: placement.callId, tool: placement.tool } }
      : { toolCall: { toolCallId: placement.callId, toolName: `${profile.toolNaming.prefix}-${placement.tool.name}` } };
  const context = {
    theme: set.theme,
    // No styles.css.fonts: the recorded fonts load from the host's CDN.
    styles: { variables: Object.fromEntries(Object.entries(set.hostVars).filter(([name]) => !isWebviewVariable(name))) },
    displayMode,
    availableDisplayModes: profile.availableDisplayModes,
    ...profile.context,
    containerDimensions,
    ...toolIdentity,
  };
  // The view's ext-apps rejects the whole ui/initialize result over one
  // unknown style variable, and then waits for ever; fail here instead.
  const checked = McpUiHostContextSchema.safeParse(context);
  if (!checked.success) throw new Error(`${set.name} is not a valid MCP Apps host context: ${checked.error.issues.map((issue) => issue.message).join("; ")}`);
  return context as McpUiHostContext;
}

// VS Code defines its theme colours (--vscode-*) on the webview's root
// itself; the host context only refers to them (var(--vscode-…)).
const isWebviewVariable = (name: string): boolean => name.startsWith("--vscode-");

export function webviewVariables(set: HostSet): Record<string, string> {
  return Object.fromEntries(Object.entries(set.hostVars).filter(([name]) => isWebviewVariable(name)));
}
