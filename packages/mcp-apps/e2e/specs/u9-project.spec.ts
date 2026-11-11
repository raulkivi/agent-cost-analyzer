// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { modelTurnsIn, toolCallsIn } from "../support/call-log.js";
import { expect, inEachClaudeSet, test } from "../support/host-fixture.js";

// A24 §2.2-2.4 (docs/plans/mcp-apps-a24-checklist.md): U9 for a project in
// Claude Desktop, light and dark. Customer portal (portal-web and
// portal-api) is the fixture's two-currency project: Copilot's "Fix the bug"
// is billed in AI Credits, the Claude Code and pi turns are priced in USD.

const PROJECT = { projectId: "portal", since: "2026-08-09", until: "2026-11-06", bucket: "week" };

inEachClaudeSet(() => {
  test("A24 2.2 U9 project: Project cost kicker, vendor then model, tokens by type, top sessions; axe clean", async ({ host }) => {
    const view = await host.show("get_project_cost", PROJECT);

    await expect(view.title()).toHaveText("Customer portal");
    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Project cost");
    const u9 = view.costOverTime;
    for (const tile of ["Total · preferred basis", "Billed", "Reported", "Priced"] as const) await expect(u9.basisTile(tile)).toBeVisible();
    await expect(u9.chart()).toBeVisible();
    await expect(u9.vendorTable()).toBeVisible();
    await expect(u9.vendorTable()).toContainText("Anthropic");
    await expect(u9.vendorTable()).toContainText("OpenAI");
    await expect(u9.tokensByType()).toBeVisible();
    await expect(u9.topSessions()).toBeVisible();
    // The session titles are buttons: Copilot's own title, and the repository folder for the CLI agents.
    expect(await u9.sessionTitles()).toContain("Fix the bug");
    // The standalone product never says a project that exists has no projects here.
    await expect(view.content.getByText("No projects here")).toHaveCount(0);

    expect(await view.axeViolations()).toEqual([]);
    expect(toolCallsIn(host.calls)).toEqual([]);
  });

  test("A24 2.3 two currencies in U9: a line per currency, AI Credits first; the Currency control lists (AI Credits | USD), selects AI Credits and switches the chart", async ({ host }) => {
    const view = await host.show("get_project_cost", PROJECT);
    const u9 = view.costOverTime;

    // The tiles list one line per currency, AI Credits first, then USD with a "$".
    await expect(u9.basisTile("Total · preferred basis")).toHaveText(/AI Credits.*\$\d/s);
    await expect(u9.neverAddedNote()).toBeVisible();

    // §9.1 answer 5: the control reads (AI Credits | USD) and starts on AI Credits.
    await expect(u9.currencyControl()).toBeVisible();
    expect(await u9.currencyOptions()).toEqual(["AI Credits", "USD"]);
    expect(await u9.selectedCurrency()).toBe("AI Credits");
    await expect(u9.chartUnit()).toHaveText("preferred basis · AI Credits");

    await u9.chooseCurrency("USD");
    expect(await u9.selectedCurrency()).toBe("USD");
    await expect(u9.chartUnit()).toHaveText("preferred basis · USD");
    expect(await view.axeViolations()).toEqual([]);
  });

  test("A24 2.4 U9 → U1 for a project session: Project cost › Session cost, Back, the currency chosen stays and focus returns to the session row", async ({ host }) => {
    const view = await host.show("get_project_cost", PROJECT);
    const u9 = view.costOverTime;
    await u9.chooseCurrency("USD");

    await u9.openSession("portal-web");
    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Project cost › Session cost");
    await expect(view.backButton("Back to cost over time")).toBeVisible();
    await expect(view.sessionCost.turnChart()).toBeVisible();
    expect(modelTurnsIn(host.calls), "a drill-down never starts a model turn").toEqual([]);
    expect(toolCallsIn(host.calls).map((call) => call.name)).toEqual(["get_session_cost", "get_turn_series"]);
    expect(await view.axeViolations()).toEqual([]);

    const callsBeforeBack = host.calls.length;
    await view.back("Back to cost over time");
    await expect(view.title()).toHaveText("Customer portal");
    expect(await u9.selectedCurrency()).toBe("USD");
    await expect.poll(() => view.focusedControl()).toBe("portal-web");
    expect(host.calls, "Back fetches nothing").toHaveLength(callsBeforeBack);
    expect(await view.axeViolations()).toEqual([]);
  });
});
