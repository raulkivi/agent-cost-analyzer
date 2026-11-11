// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { messagesOffTemplate, modelTurnsIn, toolCallsIn } from "../support/call-log.js";
import { APP_VERSION, expect, inEachClaudeSet, test } from "../support/host-fixture.js";

// U14 (statement) and U15 (estimate) in Claude Desktop, light and dark, on
// the standalone fixture home (docs/plans/mcp-apps.md §4.5, §9.2 Q13-Q16,
// board Increment3States.dc.html cells 3-7, 14 and 15). Standalone only: the
// extension names no billing view. The fixture has no issued statement, so
// the issued diff (board cell 3) is covered by the component tests. Its
// history has 4 priced active days, under the 5 an estimate needs, so a range
// (board cell 5) is covered by the component tests too; the refusal is real.

const PORTAL_OCTOBER = { projectId: "portal", period: "2026-10" };
const PORTAL_NOVEMBER = { projectId: "portal", period: "2026-11" };
const PLAN = { projectId: "portal", activeDays: 10 };
const NARROW = { width: 360 };

inEachClaudeSet(() => {
  test("board 4 / §9.2 Q13 U14 draft statement: status, totals per currency, one table per currency with AI Credits first, five columns; axe clean", async ({ host }) => {
    const view = await host.show("get_statement", PORTAL_OCTOBER);

    await expect(view.title()).toHaveText("Customer portal · October 2026");
    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Statement");
    const u14 = view.statement;
    await expect(u14.status()).toHaveText("Draft");
    await expect(u14.totalTile("AI Credits")).toContainText("9.65");
    await expect(u14.totalTile("USD")).toContainText("$0.05");
    await expect(u14.tableUnits()).toHaveText(["AI Credits", "USD"]);
    await expect(u14.linesTable("AI Credits").getByRole("columnheader")).toHaveText(["Basis", "Channel", "Model", "Turns", "AI Credits"]);
    await expect(u14.linesTable("AI Credits")).toContainText("claude-sonnet-5");
    await expect(u14.linesTable("USD")).toContainText("gpt-6.1-sol");
    await expect(u14.unknownGroup()).toContainText("all 6 turns known");
    await expect(view.content.getByText(/Left off: 3 turns in 2 sessions/)).toBeVisible();
    await expect(view.footer()).toHaveText(`Read-only · local logs · v${APP_VERSION}`);

    expect(await view.axeViolations()).toEqual([]);
  });

  test("board 3 / §9.2 Q14 U14 is read-only: no issue, re-issue or export control, no tool call, no message", async ({ host }) => {
    const view = await host.show("get_statement", PORTAL_OCTOBER);

    await expect(view.statement.status()).toBeVisible();
    await expect(view.statement.controls()).toHaveCount(0);
    await expect(view.content.getByText(/Statements are issued in the Agent Cost Analyzer app\. This view cannot issue or change one\./)).toBeVisible();
    await expect(view.content.getByText(/re-issue|export/i)).toHaveCount(0);
    expect(toolCallsIn(host.calls)).toEqual([]);
    expect(modelTurnsIn(host.calls)).toEqual([]);
    expect(messagesOffTemplate(host.calls)).toEqual([]);
  });

  test("board 4 U14 draft that cannot be issued yet: says why, with one full stop; axe clean", async ({ host }) => {
    const view = await host.show("get_statement", PORTAL_NOVEMBER);

    const note = view.statement.draftNote();
    await expect(note).toContainText("Not issued. A draft is built from the logs when asked and can change. It can't be issued yet:");
    await expect(note).toContainText("hasn't ended yet");
    await expect(note).not.toContainText("..");
    expect(await view.axeViolations()).toEqual([]);
  });

  test("board 14 U14 at 360 px: the Channel column is hidden, nothing scrolls sideways; axe clean", async ({ host }) => {
    const view = await host.show("get_statement", PORTAL_OCTOBER, NARROW);

    await expect(view.statement.linesTable("AI Credits")).toBeVisible();
    await expect(view.statement.channelHeader().first()).toBeHidden();
    await expect(view.statement.linesTable("AI Credits").getByRole("columnheader", { name: "Model" })).toBeVisible();
    expect(await view.width()).toBeLessThanOrEqual(360);
    expect(await view.scrollsSideways()).toBe(false);
    expect(await view.axeViolations()).toEqual([]);
  });

  test("board 7 / §9.2 Q15 U15 refusal: the reason, every figure Unknown never 0, no range bar and no run rate; axe clean", async ({ host }) => {
    const view = await host.show("estimate_cost", PLAN);

    await expect(view.title()).toHaveText("Estimate for Customer portal");
    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Estimate");
    const u15 = view.estimate;
    await expect(u15.tag()).toHaveText(["estimate"]);
    await expect(u15.refusal()).toContainText("Only 4 active days with a known cost in the last 12 weeks; an estimate needs at least 5");
    await expect(u15.refusal()).toContainText("No range is shown rather than a guess.");
    await expect(u15.rangeBar()).toHaveCount(0);
    await expect(u15.tile("Estimate")).toContainText("Unknown");
    await expect(u15.tile("Cost per active day")).toContainText("Unknown");
    await expect(u15.tile("Planned")).toContainText("10 active days");
    await expect(view.content.getByText(/run rate|per week|\$0\.00/i)).toHaveCount(0);
    await expect(view.footer()).toHaveText(`Read-only · local logs · v${APP_VERSION}`);

    expect(await view.axeViolations()).toEqual([]);
    expect(toolCallsIn(host.calls)).toEqual([]);
  });

  test("board 6 / §9.2 Q16 U15 on another model: estimate and Simulated tags, replay coverage, turns not replayed with reasons, the self-check count; axe clean", async ({ host }) => {
    const view = await host.show("estimate_cost", { ...PLAN, model: "claude-haiku-5.5" });

    await expect(view.title()).toHaveText("Estimate on claude-haiku-5.5");
    const u15 = view.estimate;
    await expect(u15.tag()).toHaveText(["estimate", "Simulated"]);
    const block = u15.simulated();
    await expect(block).toContainText("Simulated on claude-haiku-5.5");
    await expect(block).toContainText("4 of 5 sessions replayed; 1 of 7 turns replayed.");
    await expect(block).toContainText("turns not replayed: Cannot price: no price for claude-haiku-5.5");
    await expect(block).toContainText("Self-check: self-check passed for 4 of 4 replayed sessions checked.");
    await expect(block).not.toContainText("..");
    await expect(u15.refusal()).toBeVisible();

    expect(await view.axeViolations()).toEqual([]);
  });

  test("board 15 U15 at 360 px, plain and simulated: nothing scrolls sideways; axe clean", async ({ host }) => {
    const plain = await host.show("estimate_cost", PLAN, NARROW);
    await expect(plain.title()).toHaveText("Estimate for Customer portal");
    expect(await plain.width()).toBeLessThanOrEqual(360);
    expect(await plain.scrollsSideways()).toBe(false);
    expect(await plain.axeViolations()).toEqual([]);

    const simulated = await host.show("estimate_cost", { ...PLAN, model: "claude-haiku-5.5" }, NARROW);
    await expect(simulated.estimate.simulated()).toBeVisible();
    expect(await simulated.scrollsSideways()).toBe(false);
    expect(await simulated.axeViolations()).toEqual([]);
  });
});
