// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { messagesOffTemplate, modelTurnsIn, toolCallsIn } from "../support/call-log.js";
import { APP_VERSION, expect, inEachClaudeSet, test } from "../support/host-fixture.js";

// Increment 3 task A28 (docs/plans/mcp-apps.md §4.5, board
// Increment3States.dc.html cells 1, 2 and 13): U13 called directly, and
// opened from U11 in place, in Claude Desktop light and dark. The fixture
// price book has Claude Sonnet 5.5's documented 2026-10-07 cache-read cut
// (the change U11's spec crosses). The fixture's Copilot sessions are too few
// for an observed (inferred) change, so the inferred rendering is covered by
// the component tests; here the specs prove documented changes, the empty
// state, and the U11 to U13 drill-down through the real server.

const RANGE = { since: "2026-09-01", until: "2026-10-31" };
const BEFORE = { since: "2026-10-01", until: "2026-10-06" };
const AFTER = { since: "2026-10-07", until: "2026-10-31" };
const PROJECT = { groupBy: "project", id: "portal", periodA: BEFORE, periodB: AFTER };

inEachClaudeSet(() => {
  test("A28 U13 direct: timeline, documented changes with % per token type and sources, no tool call; axe clean", async ({ host }) => {
    const view = await host.show("get_price_changes", RANGE);

    await expect(view.title()).toHaveText("Price changes, Sep 1 – Oct 31");
    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Price changes");
    const u13 = view.priceChanges;
    await expect(u13.timeline()).toBeVisible();
    await expect(u13.marks("documented").first()).toBeVisible();
    await expect(u13.entries("documented").first()).toBeVisible();
    await expect(u13.entries("documented").first()).toContainText("documented");
    await expect(u13.entries("documented").first()).toContainText("Source");
    await expect(u13.entries("observed")).toHaveCount(0);
    await expect(view.footer()).toHaveText(`Read-only · local logs · v${APP_VERSION}`);

    expect(await view.axeViolations()).toEqual([]);
    expect(toolCallsIn(host.calls)).toEqual([]);
    expect(await view.scrollsSideways()).toBe(false);
  });

  test("A28 U13 a fall is green and a rise is red, each with its written sign", async ({ host }) => {
    const view = await host.show("get_price_changes", RANGE);
    const u13 = view.priceChanges;
    const percents = u13.entries("documented").locator(".pc-percent");
    const texts = await percents.allTextContents();
    expect(texts.length).toBeGreaterThan(0);
    for (const [index, text] of texts.entries()) {
      const hue = await u13.percentHue(percents.nth(index));
      if (text.startsWith("−")) expect(hue, text).toBe("green");
      else if (text.startsWith("+")) expect(hue, text).toBe("red");
      else expect(hue, text).toBe("other");
    }
  });

  test("A28 U13 with no price change in the period: says so and what to ask; axe clean", async ({ host }) => {
    const view = await host.show("get_price_changes", { since: "2026-01-01", until: "2026-01-31" });

    await expect(view.priceChanges.emptyState()).toContainText("No price changes found in this period");
    await expect(view.priceChanges.emptyState()).toContainText("Ask for a wider period");
    await expect(view.priceChanges.timeline()).toHaveCount(0);
    expect(await view.axeViolations()).toEqual([]);
  });

  test("A28 U13 at 360 px: nothing scrolls sideways; axe clean", async ({ host }) => {
    const view = await host.show("get_price_changes", RANGE, { width: 360 });

    await expect(view.priceChanges.timeline()).toBeVisible();
    expect(await view.width()).toBeLessThanOrEqual(360);
    expect(await view.scrollsSideways()).toBe(false);
    expect(await view.axeViolations()).toEqual([]);
  });

  test("A28 U11 to U13: one get_price_changes tool call for U11's period, a kicker trail and Back; Back restores U11 with no new call and focus on the button; axe clean", async ({ host }) => {
    const view = await host.show("explain_cost_change", PROJECT);
    await expect(view.costChange.priceChangesButton()).toBeEnabled();
    expect(toolCallsIn(host.calls)).toEqual([]);

    await view.costChange.openPriceChanges();
    await expect(view.title()).toHaveText("Price changes behind the cost change");
    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Cost change › Price changes");
    await expect(view.backButton("Back to cost change")).toBeVisible();
    await expect(view.trail()).toHaveText("Cost change / Price changes");
    await expect(view.priceChanges.filterNote()).toContainText(/Showing .* with the largest price effect in the cost change\. \d+ of \d+ changes? in the range\./);
    await expect(view.priceChanges.timeline()).toBeVisible();
    // The same period as U11's two periods together, nothing else; and never a message to the model.
    expect(toolCallsIn(host.calls)).toEqual([{ name: "get_price_changes", arguments: { since: BEFORE.since, until: AFTER.until } }]);
    expect(modelTurnsIn(host.calls), "a drill-down never starts a model turn").toEqual([]);
    expect(messagesOffTemplate(host.calls)).toEqual([]);
    expect(await view.axeViolations()).toEqual([]);

    const callsBeforeBack = host.calls.length;
    await view.back("Back to cost change");
    await expect(view.title()).toHaveText("Customer portal");
    await expect(view.costChange.waterfall().first()).toBeVisible();
    await expect.poll(() => view.focusedControl()).toBe("Price changes");
    expect(host.calls).toHaveLength(callsBeforeBack);
    expect(await view.axeViolations()).toEqual([]);
  });

  test("A28 U11 to U13 from the keyboard: Tab to Price changes, Enter opens, Enter on Back returns focus to the control", async ({ host }) => {
    const view = await host.show("explain_cost_change", PROJECT);
    await view.tabTo("Price changes");
    await view.pressEnter();
    await expect(view.title()).toHaveText("Price changes behind the cost change");
    await expect.poll(() => view.focusedControl()).toBe("Back to cost change");
    await expect.poll(() => view.focusRingVisible()).toBe(true);
    await view.pressEnter();
    await expect.poll(() => view.focusedControl()).toBe("Price changes");
  });

  test("A28 U11 to U13 at 360 px: nothing scrolls sideways at either level", async ({ host }) => {
    const view = await host.show("explain_cost_change", PROJECT, { width: 360 });
    await view.costChange.openPriceChanges();
    await expect(view.title()).toHaveText("Price changes behind the cost change");
    expect(await view.width()).toBeLessThanOrEqual(360);
    expect(await view.scrollsSideways()).toBe(false);
    expect(await view.axeViolations()).toEqual([]);
  });
});
