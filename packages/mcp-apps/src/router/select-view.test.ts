// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { selectView } from "./select-view.js";

const sessionShape = { sessionId: "s1", title: "t", topTurns: [] };
const rollupShape = { sessionCount: 1, topSessions: [], daily: [] };
const findingsShape = { total: 0, bySeverity: {}, findings: [] };

describe("selectView", () => {
  it.each([
    ["get_session_cost", "session-cost"],
    ["get_cost_rollup", "cost-rollup"],
    ["list_findings", "findings"],
    ["explain_cost_change", "cost-change"],
  ])("routes toolInfo.tool.name %s to %s", (name, view) => {
    expect(selectView({ toolInfo: { tool: { name } } }, undefined)).toEqual({ view });
  });

  it("falls back to toolCall.toolName when VS Code sends no toolInfo", () => {
    expect(selectView({ toolCall: { toolName: "get_cost_rollup" } }, undefined)).toEqual({ view: "cost-rollup" });
  });

  // A0 spike: VS Code prefixes the name with the server's id
  // (aca-spike-get_session_cost); its LM tool ids use mcp_<server>_<tool>.
  it.each([
    ["aca-spike-get_session_cost", "session-cost"],
    ["ai-credits-analyzer-get_cost_rollup", "cost-rollup"],
    ["mcp_aicreditsanal_list_findings", "findings"],
    ["ai-credits-analyzer-explain_cost_change", "cost-change"],
    ["mcp_aicreditsanal_explain_cost_change", "cost-change"],
  ])("routes VS Code's server-prefixed toolCall.toolName %s to %s", (toolName, view) => {
    expect(selectView({ toolCall: { toolName } }, undefined)).toEqual({ view });
  });

  it("does not match a tool whose name only ends with a known name's letters", () => {
    expect(selectView({ toolCall: { toolName: "xget_session_cost" } }, sessionShape)).toEqual({ view: "none" });
  });

  it("prefers toolInfo over toolCall over shape", () => {
    const context = { toolInfo: { tool: { name: "list_findings" } }, toolCall: { toolName: "get_session_cost" } };
    expect(selectView(context, sessionShape)).toEqual({ view: "findings" });
    expect(selectView({ toolCall: { toolName: "get_session_cost" } }, findingsShape)).toEqual({ view: "session-cost" });
  });

  it("uses the structuredContent shape when the host names no tool", () => {
    expect(selectView({}, sessionShape)).toEqual({ view: "session-cost" });
    expect(selectView(undefined, rollupShape)).toEqual({ view: "cost-rollup" });
    expect(selectView({ theme: "dark" }, findingsShape)).toEqual({ view: "findings" });
  });

  it("recognises an explain_cost_change result by shape, apart from the other shapes", () => {
    const varianceShape = { periodA: {}, periodB: {}, currencies: [], notExplained: {} };
    expect(selectView({}, varianceShape)).toEqual({ view: "cost-change" });
    expect(selectView({}, { currencies: [], periodA: {} })).toEqual({ view: "none" });
    expect(selectView({}, { ...rollupShape, ...varianceShape })).toEqual({ view: "cost-rollup" });
  });

  it("gives a tool this bundle has no view for the neutral state, not a shape guess", () => {
    expect(selectView({ toolInfo: { tool: { name: "get_statement" } } }, sessionShape)).toEqual({ view: "none" });
  });

  it("gives unknown, empty or non-object results the neutral state", () => {
    expect(selectView(undefined, undefined)).toEqual({ view: "none" });
    expect(selectView({}, null)).toEqual({ view: "none" });
    expect(selectView({}, "text")).toEqual({ view: "none" });
    expect(selectView({}, { sessionId: "s1" })).toEqual({ view: "none" });
  });
});
