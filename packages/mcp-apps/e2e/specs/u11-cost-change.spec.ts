// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { toolCallsIn } from "../support/call-log.js";
import { APP_VERSION, expect, inEachClaudeSet, test } from "../support/host-fixture.js";

// A24 §2.3 (U11 part), 2.7 and 2.8 (docs/plans/mcp-apps-a24-checklist.md):
// U11 in Claude Desktop, light and dark. Customer portal across Claude
// Sonnet 5.5's documented 2026-10-07 cache-read cut (the fixture's price
// change, as in the web suite's MCP exit criterion), so the price effect is
// not zero.

const BEFORE = { since: "2026-10-01", until: "2026-10-06" };
const AFTER = { since: "2026-10-07", until: "2026-10-31" };
const PROJECT = { groupBy: "project", id: "portal", periodA: BEFORE, periodB: AFTER };
const REPOSITORY = { groupBy: "repository", id: "github.com/acme/portal-web", periodA: BEFORE, periodB: AFTER };

inEachClaudeSet(() => {
  test("A24 2.7 U11 project: period tiles, Change, Not explained, the waterfall and the model table; axe clean", async ({ host }) => {
    const view = await host.show("explain_cost_change", PROJECT);

    await expect(view.title()).toHaveText("Customer portal");
    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Cost change");
    const u11 = view.costChange;
    // One block per currency; the first block carries every tile.
    await expect(u11.periodTile("A").first()).toBeVisible();
    await expect(u11.periodTile("B").first()).toBeVisible();
    for (const tile of ["Change", "Not explained"]) await expect(u11.tile(tile).first()).toBeVisible();
    await expect(u11.tile("Not explained").first()).toContainText("2 turns");
    await expect(u11.tile("Not explained").first()).toContainText("no price for these turns; not counted as 0");
    await expect(u11.waterfall().first()).toBeVisible();
    await expect(u11.modelTable().first()).toBeVisible();
    await expect(view.footer()).toHaveText(`Read-only · local logs · v${APP_VERSION}`);

    expect(await view.axeViolations()).toEqual([]);
    expect(toolCallsIn(host.calls)).toEqual([]);
  });

  test("A24 2.7 U11 repository: the same tiles, waterfall and model table; axe clean", async ({ host }) => {
    const view = await host.show("explain_cost_change", REPOSITORY);

    await expect(view.title()).toHaveText("github.com/acme/portal-web");
    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Cost change");
    const u11 = view.costChange;
    await expect(u11.periodTile("A").first()).toBeVisible();
    await expect(u11.tile("Change").first()).toBeVisible();
    await expect(u11.waterfall().first()).toBeVisible();
    await expect(u11.modelTable().first()).toBeVisible();

    expect(await view.axeViolations()).toEqual([]);
  });

  test("A24 2.3 two currencies in U11: each currency under its own heading, the Not explained tile once", async ({ host }) => {
    const view = await host.show("explain_cost_change", PROJECT);
    const u11 = view.costChange;

    // The fixture's turns are priced in USD only (Copilot's AI Credits are billed, not priced, and U11 uses
    // the priced basis), so there is one block: a second block needs a priced AI Credits turn the
    // fixture cannot produce. View-model tests cover two blocks (cost-variance.test.ts).
    await expect(u11.currencyHeadings()).toHaveText(["USD"]);
    await expect(u11.tile("Not explained")).toHaveCount(1);
  });

  test("A24 2.8 U11 waterfall: a fall is green, a rise is red, neither is blue, each with its written sign", async ({ host }) => {
    const fall = await host.show("explain_cost_change", PROJECT);
    // Usage fell from the first period to the second.
    expect(await fall.costChange.effectDirection("usage")).toBe("decrease");
    expect(await fall.costChange.effectHue("usage")).toBe("green");
    await expect(fall.costChange.effectValue("usage")).toHaveText(/^−/);

    const rise = await host.show("explain_cost_change", { ...PROJECT, periodA: AFTER, periodB: BEFORE });
    expect(await rise.costChange.effectDirection("usage")).toBe("increase");
    expect(await rise.costChange.effectHue("usage")).toBe("red");
    await expect(rise.costChange.effectValue("usage")).toHaveText(/^\+/);
    expect(await fall.axeViolations()).toEqual([]);
    expect(await rise.axeViolations()).toEqual([]);
  });

  // Found by G4 in a real Copilot Chat (a 561 px view): the Not explained
  // reasons sit in two columns, and a logged reason with a long unbroken
  // word (a setting id) widened its column past the view.
  // Both periods hold the fixture's one Copilot turn (2026-10-27), whose
  // reason names github.copilot.chat.otel.dbSpanExporter.enabled.
  test("A24 2.9 U11 with turns not explained, at 560 px: the logged reasons wrap in their two columns and nothing scrolls sideways", async ({ host }) => {
    const copilotDay = { since: "2026-10-27", until: "2026-10-27" };
    const view = await host.show("explain_cost_change", { ...REPOSITORY, periodA: copilotDay, periodB: copilotDay }, { width: 560 });

    await expect(view.content.getByText(/dbSpanExporter/)).toHaveCount(2);
    expect(await view.width()).toBeLessThanOrEqual(560);
    expect(await view.scrollsSideways()).toBe(false);
  });
});
