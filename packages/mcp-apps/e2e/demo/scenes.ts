// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { totalBeatMs } from "../../../vscode-extension/scripts/demo/scene-timeline.mts";
import type { DemoScene } from "../../../web/e2e/demo/support/demo-driver.js";
import type { McpHost } from "../support/mcp-host.js";
import type { ViewFrame } from "../support/view-frame.js";

// F1 to F3 (docs/plans/docs-refresh-and-demo-recordings.md §4.2): close-ups of
// the MCP App views, shown alone in the fake host. Steps read the view through
// `context.view`, which a step that opens another view replaces. The fixture
// home's made-up data; a fixed clock. The specs assert each scene's end state.

export interface DemoContext {
  host: McpHost;
  view: ViewFrame;
  // The fixture's two-turn Claude Code session of 2026-10-05 (F3's replay).
  session: { sessionId: string; provider: string };
}

export const DEMO_MAX_SECONDS = 20;
// What a step costs besides its beat: the pointer's glide and the click's round trip.
const STEP_OVERHEAD_MS = 800;
const LEAD_MS = 800;

export function estimatedSeconds(scene: DemoScene): number {
  return (totalBeatMs(scene) + scene.steps.length * STEP_OVERHEAD_MS + LEAD_MS) / 1000;
}

export const FULLSCREEN = { displayMode: "fullscreen" } as const;

const OCTOBER = { since: "2026-10-01", until: "2026-10-31" };
const BEFORE = { since: "2026-10-01", until: "2026-10-06" };
const AFTER = { since: "2026-10-07", until: "2026-10-31" };

export const F1_ARGS = { groupBy: "project", ids: ["portal", "billing", "mobile"], ...OCTOBER };
export const F2_ARGS = { groupBy: "project", id: "portal", periodA: BEFORE, periodB: AFTER };
export const F2_CURRENCY_ARGS = { projectId: "portal", ...OCTOBER };
export const f3Args = (session: DemoContext["session"]) => ({ ...session, models: ["gpt-6.1-sol", "claude-opus-5.5"] });
export const STATEMENT_ARGS = { projectId: "portal", period: "2026-10" };
export const ESTIMATE_ARGS = { projectId: "portal", activeDays: 10, model: "claude-haiku-5.5" };

export const F1 = (context: DemoContext): DemoScene => ({
  id: "F1",
  slug: "drill-down",
  title: "Comparison to turn, and back",
  steps: [
    {
      label: "Open Customer portal from the comparison",
      beatMs: 1800,
      action: (_page, pointer) => pointer.click(context.view.content.getByRole("button", { name: "Customer portal", exact: true })),
    },
    {
      label: "Open its top session",
      beatMs: 1800,
      action: (_page, pointer) => pointer.click(context.view.costOverTime.topSessions().getByRole("button", { name: "Fix the bug", exact: true }).first()),
    },
    { label: "Open a turn", beatMs: 2200, action: (_page, pointer) => pointer.click(context.view.sessionCost.turnToggle(1)) },
    {
      label: "Hide the turn",
      beatMs: 900,
      action: (_page, pointer) => pointer.click(context.view.content.getByRole("button", { name: "Hide turn", exact: true })),
    },
    {
      label: "Back to the project, focus on the session",
      beatMs: 1500,
      action: (_page, pointer) => pointer.click(context.view.backButton("Back to Customer portal")),
    },
    {
      label: "Back to the comparison, focus on the project",
      beatMs: 1800,
      action: (_page, pointer) => pointer.click(context.view.backButton("Back to comparison")),
    },
  ],
});

export const F2 = (context: DemoContext): DemoScene => ({
  id: "F2",
  slug: "cost-change",
  title: "Cost change, price changes and currencies",
  steps: [
    { label: "Look at the waterfall", beatMs: 2400, action: (_page, pointer) => pointer.glideTo(context.view.costChange.waterfall().first()) },
    { label: "Open Price changes", beatMs: 2600, action: (_page, pointer) => pointer.click(context.view.costChange.priceChangesButton()) },
    { label: "Back to the cost change", beatMs: 1500, action: (_page, pointer) => pointer.click(context.view.backButton("Back to cost change")) },
    {
      label: "Show the project's cost over time",
      beatMs: 1800,
      action: async () => {
        context.view = await context.host.show("get_project_cost", F2_CURRENCY_ARGS, FULLSCREEN);
      },
    },
    {
      label: "Switch to USD",
      beatMs: 2000,
      action: (_page, pointer) => pointer.click(context.view.costOverTime.currencyControl().getByText("USD", { exact: true })),
    },
    {
      label: "Switch back to AI Credits",
      beatMs: 2000,
      action: (_page, pointer) => pointer.click(context.view.costOverTime.currencyControl().getByText("AI Credits", { exact: true })),
    },
  ],
});

export const F3 = (context: DemoContext): DemoScene => ({
  id: "F3",
  slug: "replay-billing",
  title: "Model comparison, statement and estimate",
  steps: [
    { label: "Look at the model comparison", beatMs: 2400, action: (_page, pointer) => pointer.glideTo(context.view.replay.measuredRow()) },
    { label: "Replay the session on one model", beatMs: 2800, action: (_page, pointer) => pointer.click(context.view.replay.modelButton("gpt-6.1-sol")) },
    { label: "Back to the model comparison", beatMs: 1200, action: (_page, pointer) => pointer.click(context.view.backButton("Back to model comparison")) },
    {
      label: "Show the project's statement",
      beatMs: 2600,
      action: async (_page, pointer) => {
        context.view = await context.host.show("get_statement", STATEMENT_ARGS, FULLSCREEN);
        await pointer.glideTo(context.view.statement.totalTile("AI Credits"));
      },
    },
    {
      label: "Show an estimate on another model",
      beatMs: 2600,
      action: async (_page, pointer) => {
        context.view = await context.host.show("estimate_cost", ESTIMATE_ARGS, FULLSCREEN);
        await pointer.glideTo(context.view.estimate.simulated());
      },
    },
  ],
});
