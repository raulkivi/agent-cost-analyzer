// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { messagesOffTemplate, modelTurnsIn, toolCallsIn } from "../support/call-log.js";
import { expect, inEachClaudeSet, test } from "../support/host-fixture.js";

// A24 §2.3 (U10 part), 2.5 and 2.6 (docs/plans/mcp-apps-a24-checklist.md):
// U10 and the full U10 → U9 → U1 chain for projects in Claude Desktop, light
// and dark. The fixture home's three projects in October 2026; Customer
// portal's top sessions include the Copilot session "Fix the bug" (billed in
// AI Credits). Each level is a tool call the view makes through the host,
// never a message to the model; Back fetches nothing and puts focus back on
// the row it left.

const OCTOBER = { since: "2026-10-01", until: "2026-10-31" };
const PROJECTS = { groupBy: "project", ids: ["portal", "billing", "mobile"], ...OCTOBER };

inEachClaudeSet(() => {
  test("A24 2.3 two currencies in U10: a money cell lists AI Credits first, then USD; Together has two totals; the units sentence says they are never added or converted", async ({ host }) => {
    const view = await host.show("compare_costs", PROJECTS);
    const u10 = view.comparison;

    await expect(u10.unitsNote()).toContainText("AI Credits first, then USD");
    await expect(u10.unitsNote()).toContainText("never added or converted");
    // Customer portal: 9.65 AI Credits, then $0.213.
    await expect(u10.totalCell("Customer portal")).toHaveText(/^9\.65.*\$0\.213/s);
    // Together: one total per currency, AI Credits first.
    await expect(u10.together()).toHaveText(/9\.65.*\$0\.466/s);
    expect(await view.axeViolations()).toEqual([]);
  });

  test("A24 2.5 U10 → U9 → U1 for projects: each level a tool call, Back one level at a time with focus on the row; axe clean at every level", async ({ host }) => {
    const view = await host.show("compare_costs", PROJECTS);
    await expect(view.title()).toHaveText("3 projects compared");
    await expect(view.comparison.table("project")).toBeVisible();
    expect(await view.axeViolations()).toEqual([]);

    // Level 2: U9 for the project, by get_project_cost with the row's id and the comparison's period.
    await view.comparison.openRow("Customer portal");
    await expect(view.title()).toHaveText("Customer portal");
    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Cost comparison › Project cost");
    await expect(view.backButton("Back to comparison")).toBeVisible();
    await expect(view.costOverTime.topSessions()).toBeVisible();
    expect(toolCallsIn(host.calls)).toEqual([{ name: "get_project_cost", arguments: expect.objectContaining({ projectId: "portal", ...OCTOBER }) }]);
    expect(await view.axeViolations()).toEqual([]);

    // Level 3: U1 for a top session, by get_session_cost (and the app-only get_turn_series for its chart).
    await view.costOverTime.openSession("Fix the bug");
    await expect(view.title()).toHaveText("Fix the bug");
    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Cost comparison › Project cost › Session cost");
    await expect(view.backButton("Back to Customer portal")).toBeVisible();
    await expect(view.trail()).toHaveText("Cost comparison / Customer portal / Fix the bug");
    await expect(view.sessionCost.turnChart()).toBeVisible();
    const toSession = toolCallsIn(host.calls).slice(1);
    expect(toSession.map((call) => call.name)).toEqual(["get_session_cost", "get_turn_series"]);
    expect(toSession[0]!.arguments).toEqual({ sessionId: expect.any(String), provider: expect.any(String) });
    expect(modelTurnsIn(host.calls), "a drill-down never starts a model turn").toEqual([]);
    expect(await view.axeViolations()).toEqual([]);

    // Back from each level: one level up, no new tool call, focus on the row that was opened.
    const callsBeforeBack = host.calls.length;
    await view.back("Back to Customer portal");
    await expect(view.title()).toHaveText("Customer portal");
    await expect.poll(() => view.focusedControl()).toBe("Fix the bug");
    expect(await view.axeViolations()).toEqual([]);
    await view.back("Back to comparison");
    await expect(view.title()).toHaveText("3 projects compared");
    await expect.poll(() => view.focusedControl()).toBe("Customer portal");
    expect(host.calls).toHaveLength(callsBeforeBack);
    expect(await view.axeViolations()).toEqual([]);
  });

  test("A24 2.5 U1 opened from U9: Ask about this session sends only the fixed template", async ({ host }) => {
    const view = await host.show("compare_costs", PROJECTS);
    await view.comparison.openRow("Customer portal");
    await view.costOverTime.openSession("Fix the bug");
    await expect(view.title()).toHaveText("Fix the bug");

    await view.sessionCost.askAboutSession();
    await expect.poll(() => modelTurnsIn(host.calls)).toHaveLength(1);
    expect(messagesOffTemplate(host.calls)).toEqual([]);
  });
});

// A24 2.6 asks for the project comparison with no projects and expects the
// title "No projects here". The real server cannot produce that: compare_costs
// needs two ids and answers an unknown id with a zero-turn row, so U10's
// empty state (CostCompareView.test.tsx) is never reached. What the user sees
// with no projects is asserted instead: Unknown rows, never 0, no chart.
test.describe("A24 2.6 no projects", () => {
  test.use({ withProjects: false });

  inEachClaudeSet(() => {
    test("A24 2.6 U10 with no projects (the real server's answer): rows with no turns read Unknown, never 0; axe clean", async ({ host }) => {
      const view = await host.show("compare_costs", { groupBy: "project", ids: ["portal", "billing"], ...OCTOBER });

      await expect(view.title()).toHaveText("2 projects compared");
      await expect(view.comparison.unitsNote()).toContainText("No cost is known");
      await expect(view.comparison.totalCell("portal")).toContainText("Unknown");
      await expect(view.comparison.totalCell("portal")).toContainText("no turns");
      await expect(view.comparison.row("portal")).toContainText("0 sessions · 0 turns");
      expect(await view.axeViolations()).toEqual([]);
    });

    test("A24 2.6 U9 for a project that does not exist: the tool's error text as a state, no empty chart (§9.1 answer 1)", async ({ host }) => {
      const view = await host.show("get_project_cost", { projectId: "portal", ...OCTOBER });

      await expect(view.alert()).toContainText('Unknown project id "portal"');
      await expect(view.costOverTime.chart()).toHaveCount(0);
      expect(await view.axeViolations()).toEqual([]);
    });
  });
});
