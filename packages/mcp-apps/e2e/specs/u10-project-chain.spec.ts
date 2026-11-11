// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { messagesOffTemplate, modelTurnsIn, toolCallsIn } from "../support/call-log.js";
import { expect, test } from "../support/host-fixture.js";

// A24 §2.5 (docs/plans/mcp-apps-a24-checklist.md): the full U10 → U9 → U1
// chain for projects in Claude Desktop, dark. The fixture home's three
// projects in October 2026; Customer portal's top sessions include the
// Copilot session "Fix the bug" (billed in AI Credits). Each level is a
// tool call the view makes through the host, never a message to the
// model; Back fetches nothing and puts focus back on the row it left.

const OCTOBER = { since: "2026-10-01", until: "2026-10-31" };

test("A24 2.5 U10 → U9 → U1 for projects: each level a tool call, Back one level at a time with focus on the row; axe clean at every level", async ({ host }) => {
  const view = await host.show("compare_costs", { groupBy: "project", ids: ["portal", "billing", "mobile"], ...OCTOBER });
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
  await view.back("Back to comparison");
  await expect(view.title()).toHaveText("3 projects compared");
  await expect.poll(() => view.focusedControl()).toBe("Customer portal");
  expect(host.calls).toHaveLength(callsBeforeBack);
});

test("A24 2.5 U1 opened from U9: Ask about this session sends only the fixed template", async ({ host }) => {
  const view = await host.show("compare_costs", { groupBy: "project", ids: ["portal", "billing", "mobile"], ...OCTOBER });
  await view.comparison.openRow("Customer portal");
  await view.costOverTime.openSession("Fix the bug");
  await expect(view.title()).toHaveText("Fix the bug");

  await view.sessionCost.askAboutSession();
  await expect.poll(() => modelTurnsIn(host.calls)).toHaveLength(1);
  expect(messagesOffTemplate(host.calls)).toEqual([]);
});
