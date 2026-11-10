// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// A14 visual check (docs/plans/mcp-apps.md §7): renders the real App, CSS
// and host theme binding with fixture data and the fake port, so a browser
// can screenshot each view in light and dark at any width. Built on demand
// with test/visual/vite.config.ts into a scratch directory; never part of
// dist/views.html.
//
//   ?view=session-cost|cost-rollup|findings|cost-compare|none  &theme=light|dark  &state=loaded|empty|error
import { applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@agent-cost-analyzer/web/theme.css";
import "../../src/theme/brand.css";
import "../../src/theme/theme-mcp-host.css";
import "../../src/theme/views.css";
import claudeLight from "../../../../docs/plans/mcp-apps-spike-results/claude-light.json";
import claudeDark from "../../../../docs/plans/mcp-apps-spike-results/claude-dark.json";
import { App } from "../../src/App.js";
import type { ViewBrand } from "../../src/brand/view-brand.js";
import { FakeAppHostPort } from "../../src/host/fake-app-host-port.js";
import { bindHostTheme } from "../../src/theme/apply-host-theme.js";
import { costRollup, sessionCost, turnSeries } from "../../src/view-models/fixtures.js";
import { comparisonChange, comparisonRow, costComparison, costSeries, costTotal, projectCost } from "../../src/view-models/cost-analysis-fixtures.js";
import { turnView } from "../../src/view-models/turn-view-fixture.js";
import { findingsResult, SAMPLE_FINDINGS } from "../../src/views/findings/fixtures.js";

const params = new URLSearchParams(location.search);
const view = params.get("view") ?? "session-cost";
const theme = params.get("theme") === "dark" ? "dark" : "light";
const state = params.get("state") ?? "loaded";

const brand: ViewBrand = { productId: "vscode-extension", displayName: "AI Credits Analyzer", version: "0.4.0" };

// A 42-turn series, closer to a real session than the unit fixture.
const turns = Array.from({ length: 42 }, (_, index) => ({
  turnIndex: index,
  model: "claude-sonnet-5.5",
  aiCredits: index === 9 || index === 30 ? null : Math.round((0.15 + Math.abs(Math.sin(index * 1.7)) * (index === 17 ? 4 : 0.9)) * 100) / 100,
  inputTokens: 40_000 + index * 5000,
  cacheRead: 30_000 + index * 4000,
  output: 900,
  estimated: index === 21,
  events: index === 17 ? ["compaction" as const] : index === 5 ? ["model-switch" as const] : [],
}));
const series = turnSeries({ totalTurns: 42, turns });

const rollup = costRollup();
rollup.topSessions = [
  ...rollup.topSessions,
  { ...rollup.topSessions[0]!, sessionId: "c0ffee01", title: "Investigate why the nightly integration suite times out on the ARM runners and add retries", model: "gpt-6.1-sol" },
];

const port = new FakeAppHostPort();
port.toolResults.set("get_turn_series", { structuredContent: series });
port.toolResults.set("get_turn", { structuredContent: turnView() });
port.toolResults.set("get_session_cost", { structuredContent: sessionCost() });
port.toolResults.set("list_findings", { structuredContent: findingsResult(SAMPLE_FINDINGS, { total: 3 }) });

port.toolResults.set("get_repository_cost", { structuredContent: costSeries() });
port.toolResults.set("get_project_cost", { structuredContent: projectCost() });

// U10: four rows as the board has them, one partly known and one with no earlier figure.
const comparison = costComparison({
  total: costTotal(952, 951, 952),
  rows: [
    comparisonRow({ key: "a", label: "provider-core", sessions: 38, turns: 346, total: costTotal(449, 346, 346), change: [comparisonChange(449, 380.2, 0.181)], share: [{ currency: "AI_CREDITS", share: 0.472 }] }),
    comparisonRow({ key: "b", label: "checkout-web", sessions: 29, turns: 262, total: costTotal(312, 262, 262), change: [comparisonChange(312, 345.6, -0.097)], share: [{ currency: "AI_CREDITS", share: 0.328 }] }),
    comparisonRow({ key: "c", label: "infra-scripts", sessions: 12, turns: 97, total: costTotal(149.8, 97, 97), change: [], share: [{ currency: "AI_CREDITS", share: 0.157 }] }),
    comparisonRow({ key: "d", label: "docs-site", sessions: 9, turns: 44, total: costTotal(41.2, 31, 44), change: [comparisonChange(41.2, 52, -0.208)], share: [{ currency: "AI_CREDITS", share: 0.043 }] }),
  ],
});

const tool = { "session-cost": "get_session_cost", "cost-rollup": "get_cost_rollup", findings: "list_findings", "cost-compare": "compare_costs", none: "list_sessions" }[view] ?? "get_session_cost";
const data =
  view === "session-cost"
    ? sessionCost()
    : view === "cost-rollup"
      ? rollup
      : view === "findings"
        ? state === "empty"
          ? findingsResult([], { total: 0, bySeverity: { info: 0, low: 0, medium: 0, high: 0, critical: 0 } })
          : findingsResult(SAMPLE_FINDINGS, { total: 3 })
        : view === "cost-compare"
          ? comparison
          : { sessions: [] };

const recorded = (theme === "dark" ? claudeDark : claudeLight) as { styleVariables: { defined: Record<string, string> } };
bindHostTheme(port, { applyDocumentTheme, applyHostStyleVariables, applyHostFonts });
port.pushHostContext({ toolInfo: { tool: { name: tool } }, theme, styles: { variables: recorded.styleVariables.defined } });
port.pushToolResult(state === "error" ? { isError: true } : { structuredContent: data });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App port={port} brand={brand} clipboard={{ writeText: () => Promise.resolve() }} />
  </StrictMode>,
);
