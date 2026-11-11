// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { estimate, refusedEstimate, statementAnswer } from "../view-models/increment3-fixtures.js";
import { selectView } from "./select-view.js";

const sessionShape = { sessionId: "s1", title: "t", topTurns: [] };
const rollupShape = { sessionCount: 1, topSessions: [], daily: [] };
const findingsShape = { total: 0, bySeverity: {}, findings: [] };

describe("selectView", () => {
  it.each([
    ["get_session_cost", "session-cost"],
    ["get_cost_rollup", "cost-rollup"],
    ["list_findings", "findings"],
    ["get_repository_cost", "cost-over-time"],
    ["get_project_cost", "cost-over-time"],
    ["explain_cost_change", "cost-change"],
    ["compare_costs", "cost-compare"],
    ["get_price_changes", "price-changes"],
    ["get_statement", "statement"],
    ["estimate_cost", "estimate"],
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
    ["ai-credits-analyzer-get_repository_cost", "cost-over-time"],
    ["mcp_aicreditsanal_get_project_cost", "cost-over-time"],
    ["ai-credits-analyzer-explain_cost_change", "cost-change"],
    ["mcp_aicreditsanal_explain_cost_change", "cost-change"],
    ["ai-credits-analyzer-compare_costs", "cost-compare"],
    ["mcp_aicreditsanal_compare_costs", "cost-compare"],
    ["ai-credits-analyzer-get_price_changes", "price-changes"],
    ["mcp_aicreditsanal_get_price_changes", "price-changes"],
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

  // A20: a repository or project cost result is told apart from the MVP
  // shapes, and a project's topSessions does not make it a rollup.
  it("routes the U9 shapes by their series, never to a rollup or a session", () => {
    const series = { points: [], priceChanges: [], observedChanges: [], byVendor: [], total: {}, bucket: "week" };
    expect(selectView({}, series)).toEqual({ view: "cost-over-time" });
    expect(selectView({}, { ...series, project: { id: "p" }, topSessions: [], byTokenType: [] })).toEqual({ view: "cost-over-time" });
    expect(selectView({}, { topSessions: [], points: [] })).toEqual({ view: "none" });
    expect(selectView({}, { ...rollupShape, points: [] })).toEqual({ view: "cost-rollup" });
    expect(selectView({}, { ...sessionShape, ...series })).toEqual({ view: "session-cost" });
  });

  // A21: a compare_costs result is told apart from every other shape, and none
  // of the other shapes is taken for a comparison.
  it("routes the U10 shape by its rows and periods, never to the MVP, U9 or U11 views", () => {
    const comparison = { groupBy: "repository", comparePeriod: "previous", previousSince: "2026-10-01", previousUntil: "2026-10-31", total: {}, rows: [] };
    expect(selectView({}, comparison)).toEqual({ view: "cost-compare" });
    expect(selectView({}, { ...comparison, groupBy: "project" })).toEqual({ view: "cost-compare" });
    expect(selectView({}, { rows: [], total: {} })).toEqual({ view: "none" });
    expect(selectView({}, { ...comparison, previousSince: undefined })).toEqual({ view: "none" });
    expect(selectView({}, { ...comparison, rows: "x" })).toEqual({ view: "none" });
    expect(selectView({}, { ...rollupShape, ...comparison })).toEqual({ view: "cost-rollup" });
    expect(selectView({}, { ...sessionShape, ...comparison })).toEqual({ view: "session-cost" });
    expect(selectView({}, { ...comparison, points: [], priceChanges: [], observedChanges: [], byVendor: [] })).toEqual({ view: "cost-over-time" });
    expect(selectView({}, { ...comparison, currencies: [], periodA: {}, periodB: {}, notExplained: {} })).toEqual({ view: "cost-change" });
    expect(selectView({}, { ...findingsShape, ...comparison })).toEqual({ view: "findings" });
  });

  it("gives a tool this bundle has no view for the neutral state, not a shape guess", () => {
    expect(selectView({ toolInfo: { tool: { name: "list_projects" } } }, sessionShape)).toEqual({ view: "none" });
  });

  it("gives unknown, empty or non-object results the neutral state", () => {
    expect(selectView(undefined, undefined)).toEqual({ view: "none" });
    expect(selectView({}, null)).toEqual({ view: "none" });
    expect(selectView({}, "text")).toEqual({ view: "none" });
    expect(selectView({}, { sessionId: "s1" })).toEqual({ view: "none" });
  });

  it("routes a get_price_changes shape (changes, providers, generatedAt) when the host names no tool", () => {
    expect(selectView({}, { generatedAt: "2026-11-10T12:00:00Z", providers: [], changes: [] })).toEqual({ view: "price-changes" });
    expect(selectView({}, { providers: [], changes: [] })).toEqual({ view: "none" });
  });
});

// A29: U14 and U15, by name (bare and VS Code-prefixed) and by shape.
describe("selectView for the billing views", () => {
  it.each([
    ["ai-credits-analyzer-get_statement", "statement"],
    ["mcp_aicreditsanal_estimate_cost", "estimate"],
  ])("routes toolCall.toolName %s to %s", (toolName, view) => {
    expect(selectView({ toolCall: { toolName } }, undefined)).toEqual({ view });
  });

  it("recognises a StatementAnswer and a CostEstimate by shape, apart from the other shapes", () => {
    expect(selectView({}, statementAnswer())).toEqual({ view: "statement" });
    expect(selectView({}, estimate())).toEqual({ view: "estimate" });
    expect(selectView({}, refusedEstimate())).toEqual({ view: "estimate" });
    expect(selectView({}, { statement: {}, canIssue: {} })).toEqual({ view: "none" });
    expect(selectView({}, { label: "forecast", history: {}, runRate: {}, planned: 1 })).toEqual({ view: "none" });
  });
});
