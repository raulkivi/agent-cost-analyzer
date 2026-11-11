// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { messagesOffTemplate, modelTurnsIn, toolCallsIn } from "../support/call-log.js";
import { expect, inEachClaudeSet, test } from "../support/host-fixture.js";

// A16 §2 (docs/plans/mcp-apps-a16-checklist.md): the MVP views U1 (session
// cost), U2 (spend rollup) and U3 (findings) in Claude Desktop, light and
// dark. The checklist's rows are in its §4 table. The fixture's Copilot
// session "Fix the bug" (billed in AI Credits, 2 turns, 2026-10-27) is U1's
// session; its input-token figures are not logged, so they read Unknown.

const SESSION = { sessionId: "1c7604a0-1488-4b5d-880a-f80fd693475e", provider: "vscode" };
const OCTOBER = { since: "2026-10-01", until: "2026-10-31" };

inEachClaudeSet(() => {
  test("A16 2 U1 renders, turn drill-down works: tiles, per-turn chart, top turns; a turn opens in place and hides; no copy button in Claude; axe clean", async ({ host }) => {
    const view = await host.show("get_session_cost", SESSION);
    const u1 = view.sessionCost;

    await expect(view.title()).toHaveText("Fix the bug");
    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Session cost");
    await expect(u1.tile("AI Credits")).toContainText("9.65");
    await expect(u1.turnChart()).toBeVisible();
    await expect(u1.topTurns()).toBeVisible();
    // U1 shows no copy button in Claude Desktop: there is no VS Code panel to open.
    await expect(u1.copyTitleButton()).toHaveCount(0);
    expect(await view.axeViolations()).toEqual([]);

    await u1.openTurn(0);
    await expect(u1.turnDetail(0)).toBeVisible();
    await expect(u1.turnToggle(0)).toHaveAttribute("aria-expanded", "true");
    expect(await view.axeViolations()).toEqual([]);
    await u1.hideTurn();
    await expect(u1.turnDetail(0)).toHaveCount(0);

    // Opening a turn is a tool call for its detail, not a model turn.
    expect(modelTurnsIn(host.calls)).toEqual([]);
    expect(toolCallsIn(host.calls).map((call) => call.name)).toEqual(["get_turn_series", "get_turn"]);
  });

  test("A16 2 Unknown, never 0, where the logs do not report a figure", async ({ host }) => {
    const view = await host.show("get_session_cost", SESSION);

    // This session's cache writes are not logged: the tiles that need them say Unknown.
    await expect(view.sessionCost.tile("Input tokens")).toContainText("Unknown");
    await expect(view.sessionCost.tile("Cache hit")).toContainText("Unknown");
    await expect(view.sessionCost.tile("Input tokens")).not.toHaveText(/^Input tokens\s*0\b/);
  });

  test("A16 2 U2 renders, session drill-down and back work: tiles, daily chart, by-model and by-provider bars, top sessions; Back to cost rollup refetches nothing; axe clean", async ({ host }) => {
    const view = await host.show("get_cost_rollup", OCTOBER);
    const u2 = view.rollup;

    await expect(view.title()).toHaveText("Cost rollup");
    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Cost rollup");
    await expect(u2.tile("Sessions")).toBeVisible();
    await expect(u2.dailyChart()).toBeVisible();
    await expect(u2.byModel()).toBeVisible();
    await expect(u2.byProvider()).toBeVisible();
    await expect(u2.topSessions()).toBeVisible();
    expect(await view.axeViolations()).toEqual([]);

    await u2.openSession("portal-web");
    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Cost rollup › Session cost");
    await expect(view.backButton("Back to cost rollup")).toBeVisible();
    await expect(view.sessionCost.turnChart()).toBeVisible();
    expect(await view.axeViolations()).toEqual([]);

    const callsBeforeBack = host.calls.length;
    await view.back("Back to cost rollup");
    await expect(view.title()).toHaveText("Cost rollup");
    await expect.poll(() => view.focusedControl()).toBe("portal-web");
    expect(host.calls, "Back fetches nothing").toHaveLength(callsBeforeBack);
    expect(modelTurnsIn(host.calls)).toEqual([]);
  });

  test("A16 2 U2 Ask about this session sends only Analyse session <id>", async ({ host }) => {
    const view = await host.show("get_cost_rollup", OCTOBER);
    await view.rollup.openSession("portal-web");
    await expect(view.sessionCost.turnChart()).toBeVisible();

    await view.sessionCost.askAboutSession();
    await expect.poll(() => modelTurnsIn(host.calls)).toHaveLength(1);
    expect(messagesOffTemplate(host.calls)).toEqual([]);
  });

  test("A16 2 U3 renders, filters reload in place, evidence collapsed: severity tiles and table; the kind and severity filters call list_findings; evidence opens as plain text; axe clean", async ({ host }) => {
    const view = await host.show("list_findings", {});
    const u3 = view.findings;

    await expect(view.title()).toHaveText("Findings");
    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Findings");
    await expect(u3.summary()).toHaveText("5 findings");
    await expect(u3.severityTile("Medium")).toContainText("1");
    await expect(u3.table()).toBeVisible();
    // Evidence is collapsed by default.
    await expect(u3.whyFlagged().first()).toHaveAttribute("aria-expanded", "false");
    expect(await view.axeViolations()).toEqual([]);

    await u3.chooseKind("Anomaly");
    await expect(u3.summary()).toHaveText("1 finding");
    await u3.chooseMinSeverity("Medium and above");
    await expect(u3.summary()).toHaveText("1 finding");
    expect(toolCallsIn(host.calls).map((call) => call.name)).toEqual(["list_findings", "list_findings"]);
    expect(toolCallsIn(host.calls)[0]!.arguments).toMatchObject({ kind: ["anomaly"] });
    expect(toolCallsIn(host.calls)[1]!.arguments).toMatchObject({ kind: ["anomaly"], minSeverity: "medium" });
    expect(modelTurnsIn(host.calls)).toEqual([]);

    await u3.openEvidence();
    await expect(u3.whyFlagged().first()).toHaveAttribute("aria-expanded", "true");
    await expect(u3.table()).toContainText("Output tokens 3,000 is 6.0× the median 500");
    expect(await view.axeViolations()).toEqual([]);
  });

  test("A16 2 keyboard: Tab and Enter open a session in U2, Back returns focus to its row, and the focus ring is visible", async ({ host }) => {
    const view = await host.show("get_cost_rollup", OCTOBER);
    await expect(view.title()).toHaveText("Cost rollup");

    await view.tabTo("portal-web");
    expect(await view.focusRingVisible()).toBe(true);
    await view.pressEnter();
    await expect(view.backButton("Back to cost rollup")).toBeVisible();

    await view.tabTo("Back to cost rollup");
    expect(await view.focusRingVisible()).toBe(true);
    await view.pressEnter();
    await expect(view.title()).toHaveText("Cost rollup");
    await expect.poll(() => view.focusedControl()).toBe("portal-web");
    expect(await view.focusRingVisible()).toBe(true);
  });

  test("A16 2 keyboard: Tab and Enter open a turn in U1", async ({ host }) => {
    const view = await host.show("get_session_cost", SESSION);
    await expect(view.title()).toHaveText("Fix the bug");

    await view.tabTo("Turn 0");
    expect(await view.focusRingVisible()).toBe(true);
    await view.pressEnter();
    await expect(view.sessionCost.turnDetail(0)).toBeVisible();
  });
});
