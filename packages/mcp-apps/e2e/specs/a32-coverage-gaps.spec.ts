// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { issuedAnswerWithDiff, estimate, priceChangeList, simulatedEstimate, statementAnswer, statement } from "../../src/view-models/increment3-fixtures.js";
import { auditRollup, sessionAudit } from "../../src/view-models/audit-fixtures.js";
import { modelTurnsIn } from "../support/call-log.js";
import { APP_VERSION, expect, inEachClaudeSet, test } from "../support/host-fixture.js";

// A32 (docs/plans/mcp-apps.md §6.1): the Increment 3 states the fixture home
// can't produce, which A27-A31 covered in component tests only, now in the
// built view in Claude Desktop, light and dark. The fake host answers the
// model's tool call with a canned result (showResult): an issued statement
// with a diff (issuing is an app action), an estimate range (the fixture has
// 4 priced active days, an estimate needs 5), an inferred rise (the fixture's
// Copilot weeks are too few for one) and audits with failed calls (the
// fixture's sessions record no tool calls). The figures are the view models'
// own fixtures, parsed with the domain schemas, so they match what the tools send.

const NARROW = { width: 360 };

inEachClaudeSet(() => {
  test("A32 U14 issued statement with a diff: Issued status, the amber record alert, changed, added and removed lines, per-currency totals, what else changed; nothing to press; axe clean", async ({ host }) => {
    const view = await host.showResult("get_statement", issuedAnswerWithDiff(), { args: { projectId: "portal", period: "2026-10" } });
    const u14 = view.statement;

    await expect(view.title()).toHaveText("Customer portal · October 2026");
    await expect(u14.status()).toContainText("Issued Nov 2");
    await expect(u14.issuedDiffAlert()).toHaveText("A re-run today differs from the issued copy. The issued copy stays the statement of record. Nothing here changes it.");
    await expect(u14.diffTable().getByRole("columnheader")).toHaveText(["Line", "Issued", "Re-run", "Difference"]);
    await expect(u14.diffRow("billed, github-copilot, gpt-5.5")).toBeVisible();
    // An added line has no earlier figure (never "from 0"); a removed one has no re-run figure.
    await expect(u14.diffRow("priced, anthropic-api, claude-haiku-5.5")).toContainText("added");
    await expect(u14.diffRow("priced, anthropic-api, claude-haiku-5.5")).toContainText("no earlier figure");
    await expect(u14.diffRow("billed, no channel, o4")).toContainText("removed");
    await expect(u14.diffRow("Total, AI Credits")).toBeVisible();
    await expect(u14.diffRow("Total, USD")).toBeVisible();
    await expect(u14.diffTable()).not.toContainText(/from 0/i);
    await expect(u14.whatElseChanged()).toContainText("1 session added, none removed");
    await expect(u14.whatElseChanged()).toContainText("unknown turns 1 → 2");
    await expect(u14.whatElseChanged()).toContainText("The price book changed");
    await expect(view.footer()).toHaveText(`Read-only · local logs · v${APP_VERSION}`);

    // Read-only: no issue, re-issue or export control; only the scrollable tables take focus.
    await expect(u14.controls()).toHaveCount(0);
    await expect(u14.scrollRegions()).toHaveCount(3);
    expect(await view.axeViolations()).toEqual([]);
    expect(host.calls).toEqual([]);
  });

  test("A32 U14 issued statement whose re-run matches: says so, no diff table; axe clean", async ({ host }) => {
    const issued = statement({ status: "issued", issuedAt: "2026-11-02T09:00:00.000Z" });
    const answer = statementAnswer({
      statement: issued,
      rerun: issued,
      canIssue: { ok: false, reason: "The period is already issued" },
      diff: { changed: false, lines: [], totals: [], unknownTurns: { issued: 1, current: 1 }, sessions: { added: [], removed: [] }, inputs: { priceBookChanged: false, projectsFileChanged: false } },
    });
    const view = await host.showResult("get_statement", answer, { args: { projectId: "portal", period: "2026-10" } });

    await expect(view.statement.issuedMatchesNote()).toBeVisible();
    await expect(view.statement.issuedDiffAlert()).toHaveCount(0);
    await expect(view.statement.diffTable()).toHaveCount(0);
    await expect(view.statement.controls()).toHaveCount(0);
    expect(await view.axeViolations()).toEqual([]);
    expect(host.calls).toEqual([]);
  });

  test("A32 U14 issued statement with a diff at 360 px: nothing scrolls sideways; axe clean", async ({ host }) => {
    const view = await host.showResult("get_statement", issuedAnswerWithDiff(), { ...NARROW, args: { projectId: "portal", period: "2026-10" } });

    await expect(view.statement.diffTable()).toBeVisible();
    expect(await view.width()).toBeLessThanOrEqual(360);
    expect(await view.scrollsSideways()).toBe(false);
    expect(await view.axeViolations()).toEqual([]);
  });

  test("A32 U15 estimate with a p50–p90 range: the range bar named with both ends, the estimate tag, no single run-rate number; axe clean", async ({ host }) => {
    const view = await host.showResult("estimate_cost", estimate(), { args: { projectId: "portal", activeDays: 10 } });
    const u15 = view.estimate;

    await expect(view.title()).toHaveText("Estimate for Customer portal");
    await expect(u15.tag()).toHaveText(["estimate"]);
    await expect(u15.rangeHeading()).toHaveText("About $95.00 to $210.00 USD");
    await expect(u15.rangeBar()).toHaveAccessibleName("Estimated range $95.00 to $210.00 USD, p50 to p90");
    await expect(u15.rangeBar()).toContainText("p50");
    await expect(u15.rangeBar()).toContainText("p90");
    await expect(u15.tile("Cost per active day")).toContainText("$9.50 – $21.00");
    await expect(u15.refusal()).toHaveCount(0);
    // The fixture's run rate ($12.90 a day, $25.87 a week) and its history total would read as one number.
    await expect(view.content.getByText(/12\.90|25\.87|310\.40|run rate|per week/i)).toHaveCount(0);

    expect(await view.axeViolations()).toEqual([]);
    expect(host.calls).toEqual([]);
  });

  test("A32 U15 simulated estimate with a range: estimate and Simulated tags, replay coverage, a failed self-check named; axe clean", async ({ host }) => {
    const view = await host.showResult("estimate_cost", simulatedEstimate(), { args: { projectId: "portal", activeDays: 10, model: "claude-sonnet-5.5" } });
    const u15 = view.estimate;

    await expect(view.title()).toHaveText("Estimate on claude-sonnet-5.5");
    await expect(u15.tag()).toHaveText(["estimate", "Simulated"]);
    await expect(u15.rangeBar()).toBeVisible();
    const block = u15.simulated();
    await expect(block).toContainText("20 of 24 sessions replayed; 700 of 800 turns replayed.");
    await expect(block).toContainText("100 turns not replayed:");
    await expect(block).toContainText("Self-check: self-check passed for 17 of 18 replayed sessions checked.");
    await expect(block).toContainText("1 failed, so the range may be off.");

    expect(await view.axeViolations()).toEqual([]);
    expect(host.calls).toEqual([]);
  });

  test("A32 U15 range at 360 px, plain and simulated: nothing scrolls sideways; axe clean", async ({ host }) => {
    const plain = await host.showResult("estimate_cost", estimate(), { ...NARROW, args: { projectId: "portal", activeDays: 10 } });
    await expect(plain.estimate.rangeBar()).toBeVisible();
    expect(await plain.width()).toBeLessThanOrEqual(360);
    expect(await plain.scrollsSideways()).toBe(false);
    expect(await plain.axeViolations()).toEqual([]);

    const simulated = await host.showResult("estimate_cost", simulatedEstimate(), { ...NARROW, args: { projectId: "portal", activeDays: 10, model: "claude-sonnet-5.5" } });
    await expect(simulated.estimate.simulated()).toBeVisible();
    expect(await simulated.scrollsSideways()).toBe(false);
    expect(await simulated.axeViolations()).toEqual([]);
  });

  test("A32 U13 inferred rise beside a documented change: one timeline, the inferred tag and dashed mark, the weekly table, '+' written in red; no tool call; axe clean", async ({ host }) => {
    const view = await host.showResult("get_price_changes", priceChangeList({ since: "2026-10-01", until: "2026-11-02" }), { args: { since: "2026-10-01", until: "2026-11-02" } });
    const u13 = view.priceChanges;

    await expect(u13.timeline()).toHaveAccessibleName(/1 documented, 1 inferred$/);
    await expect(u13.marks("documented")).toHaveCount(1);
    await expect(u13.marks("observed")).toHaveCount(1);
    expect(await u13.markDashed("observed")).toBe(true);
    expect(await u13.markDashed("documented")).toBe(false);

    const inferred = u13.entry("claude-sonnet-5.5");
    await expect(inferred).toHaveAttribute("data-kind", "observed");
    await expect(inferred.getByRole("heading", { level: 3 })).toContainText("inferred");
    await expect(u13.observedPercent("claude-sonnet-5.5")).toHaveText("+12 %");
    expect(await u13.percentHue(u13.observedPercent("claude-sonnet-5.5"))).toBe("red");
    await expect(inferred).toContainText("above the price book");
    await expect(u13.weeklyTable("claude-sonnet-5.5").getByRole("columnheader")).toHaveText(["Week", "Turns", "Billed", "Priced", "Ratio"]);
    await expect(u13.weeklyTable("claude-sonnet-5.5").getByRole("row")).toHaveCount(3);
    await expect(inferred).toContainText("the vendor has not documented it");
    // The documented change keeps its own tag and sources.
    await expect(u13.entry("gpt-5.5")).toHaveAttribute("data-kind", "documented");
    await expect(u13.entry("gpt-5.5")).toContainText("Source: src-copilot-models.");

    expect(await view.axeViolations()).toEqual([]);
    expect(host.calls).toEqual([]);
  });

  test("A32 U13 inferred rise at 360 px: the weekly table stays in its scroller, nothing scrolls sideways; axe clean", async ({ host }) => {
    const view = await host.showResult("get_price_changes", priceChangeList({ since: "2026-10-01", until: "2026-11-02" }), { ...NARROW, args: { since: "2026-10-01", until: "2026-11-02" } });

    await expect(view.priceChanges.weeklyTable("claude-sonnet-5.5")).toBeAttached();
    expect(await view.width()).toBeLessThanOrEqual(360);
    expect(await view.scrollsSideways()).toBe(false);
    expect(await view.axeViolations()).toEqual([]);
  });

  test("A32 U4 session audit with failed calls: tiles, categories, recovery cost in tokens not AI Credits, retried commands, by tool; nothing to press; axe clean", async ({ host }) => {
    const view = await host.showResult("get_session_audit", sessionAudit(), { args: { sessionId: "5b91d0c4", provider: "vscode" } });
    const u4 = view.audit;

    await expect(view.title()).toHaveText("Add retry to export job");
    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Tool-call audit");
    await expect(u4.tile("Tool calls")).toContainText("118");
    await expect(u4.tile("Failed")).toContainText("error 11 · interrupted 2 · denied 1");
    await expect(u4.tile("Failure rate")).toContainText("12.6 %");
    await expect(u4.tile("Failure rate")).toContainText("of 111 calls with a known outcome");
    await expect(u4.tile("Outcome unknown")).toContainText("7");
    await expect(u4.categories().getByRole("listitem")).toHaveCount(6);
    await expect(u4.categories().getByRole("listitem").first()).toContainText("test-or-build-failure");
    await expect(u4.recovery()).toContainText("tokens, not AI Credits");
    await expect(u4.recovery()).toContainText("6,240 out · 1,284,500 in");
    await expect(u4.recovery()).not.toContainText(/\d\s*AI Credits/);
    await expect(u4.table("Commands that were retried")).toContainText("npm test -- exporter");
    await expect(u4.table("Commands that were retried")).toContainText("succeeded on try 4");
    await expect(u4.table("Commands that were retried")).toContainText("never succeeded");
    await expect(u4.table("Tool calls by tool").getByRole("row")).toHaveCount(5);

    await expect(view.content.getByRole("button")).toHaveCount(0);
    expect(await view.axeViolations()).toEqual([]);
    expect(host.calls).toEqual([]);
  });

  test("A32 U4 rollup with failed calls: failed calls per day with an unknown day as a gap and as a table, categories, top failing commands, the sessions table, display only; axe clean", async ({ host }) => {
    const view = await host.showResult("get_audit_rollup", auditRollup(), { args: { provider: "vscode", since: "2026-10-19", until: "2026-11-01" } });
    const u4 = view.audit;

    await expect(view.title()).toHaveText("Tool-call failures");
    await expect(u4.tile("Tool calls")).toContainText("2,147");
    await expect(u4.tile("Failure rate")).toContainText("10.8 %");
    await expect(u4.tile("Left out")).toContainText("3 sessions");
    await expect(u4.failedPerDay()).toHaveAccessibleName(/^Failed calls per day, 3 days; .*1 day unknown$/);
    await expect(u4.failedPerDayTitles()).toHaveText(["Oct 19: 9 failed calls", "Oct 20: Unknown", "Oct 21: 18 failed calls"]);
    await expect(u4.unknownDays()).toHaveCount(1);
    await expect(u4.categories()).toHaveAccessibleName("149 failed calls by category");
    await expect(u4.table("Top failing commands")).toContainText("npm test");
    await expect(u4.table("Top failing commands")).toContainText("41");
    await expect(u4.table("Most failures by session")).toContainText("Fix flaky invoice test");

    // Display only: no session row opens anything (§9.2 Q10), and nothing is sent.
    await expect(view.content.getByRole("button", { name: /session|Fix flaky|Add retry/i })).toHaveCount(0);
    expect(await view.axeViolations()).toEqual([]);

    // The per-day figures as text (A32): View as table, Unknown written, never 0.
    await u4.viewPerDayAsTable().click();
    await expect(u4.perDayRows()).toHaveText(["DayFailed calls", "Oct 199", "Oct 20Unknown", "Oct 2118"]);
    expect(await view.axeViolations()).toEqual([]);
    expect(host.calls.filter((call) => call.method === "tools/call")).toEqual([]);
    expect(modelTurnsIn(host.calls)).toEqual([]);
  });

  test("A32 U4 with failed calls at 360 px, session and rollup: nothing scrolls sideways; axe clean", async ({ host }) => {
    const session = await host.showResult("get_session_audit", sessionAudit(), { ...NARROW, args: { sessionId: "5b91d0c4", provider: "vscode" } });
    await expect(session.audit.recovery()).toBeVisible();
    expect(await session.width()).toBeLessThanOrEqual(360);
    expect(await session.scrollsSideways()).toBe(false);
    expect(await session.axeViolations()).toEqual([]);

    const rollup = await host.showResult("get_audit_rollup", auditRollup(), { ...NARROW, args: { provider: "vscode", since: "2026-10-19", until: "2026-11-01" } });
    await expect(rollup.audit.failedPerDay()).toBeVisible();
    expect(await rollup.scrollsSideways()).toBe(false);
    expect(await rollup.axeViolations()).toEqual([]);
  });
});
