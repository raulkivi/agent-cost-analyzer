// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { HostContext } from "../host/app-host-port.js";

export type ViewId = "session-cost" | "cost-rollup" | "findings";
export type ViewSelection = { view: ViewId } | { view: "none" };

const BY_TOOL: Record<string, ViewId> = {
  get_session_cost: "session-cost",
  get_cost_rollup: "cost-rollup",
  list_findings: "findings",
};

// VS Code prefixes the tool name with the server's id ("<server>-<tool>",
// A0 spike) or uses its LM tool id ("mcp_<server>_<tool>"); Claude Desktop
// sends the bare name. A separator must precede the known name.
function viewForToolName(name: string): ViewId | undefined {
  for (const [tool, view] of Object.entries(BY_TOOL)) {
    if (name === tool || name.endsWith(`-${tool}`) || name.endsWith(`_${tool}`)) return view;
  }
  return undefined;
}

const hasArray =(value: Record<string, unknown>, key: string): boolean => Array.isArray(value[key]);

// Last resort when the host names no tool: the shape of structuredContent.
function byShape(structured: unknown): ViewId | undefined {
  if (typeof structured !== "object" || structured === null) return undefined;
  const s = structured as Record<string, unknown>;
  if (hasArray(s, "findings") && "bySeverity" in s) return "findings";
  if (hasArray(s, "topSessions") && hasArray(s, "daily")) return "cost-rollup";
  if (typeof s.sessionId === "string" && hasArray(s, "topTurns")) return "session-cost";
  return undefined;
}

// Picks the view (plan §4.2, A0 results): the tool name from
// hostContext.toolInfo.tool.name (Claude Desktop), then
// hostContext.toolCall.toolName (VS Code, which sends no toolInfo), then the
// shape of the result. A named tool this bundle has no view for is not
// guessed from the shape: it gets the neutral state.
export function selectView(context: HostContext | undefined, structuredContent: unknown): ViewSelection {
  const name = context?.toolInfo?.tool?.name ?? context?.toolCall?.toolName;
  if (typeof name === "string" && name !== "") {
    const view = viewForToolName(name);
    return view ? { view } : { view: "none" };
  }
  const view = byShape(structuredContent);
  return view ? { view } : { view: "none" };
}
