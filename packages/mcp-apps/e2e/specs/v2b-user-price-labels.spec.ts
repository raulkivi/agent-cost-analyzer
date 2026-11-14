// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { comparisonRow, costComparison, costTotal, costVariance, projectCost, varianceCurrency } from "../../src/view-models/cost-analysis-fixtures.js";
import { estimate, statement, statementAnswer } from "../../src/view-models/increment3-fixtures.js";
import { claudeRow, row, savingsOutput } from "../../src/view-models/savings-fixtures.js";
import { expect, inEachClaudeSet, test } from "../support/host-fixture.js";

// 1.0 V2b (threat-model 5.10, C14): "your prices" beside a figure computed with
// a price version the user added, in the chat views, in Claude light and dark.
// The fixture home prices from the bundled book only, so the results are
// canned (showResult), shaped by the view models' own fixtures. Billed figures
// carry no tag. U1, U2 and U13 show no such figure: U1 and U2 show billed AI
// Credits and token counts, U13 price-book changes. U12 is Simulated.

const MINE = ["mine-2026-10"];
const NAME = "Priced with your own price version: mine-2026-10";
const priced = (credits: number) => ({ ...costTotal(credits, 10, 10), userPriceVersionIds: MINE });
const PROJECT = { projectId: "portal", since: "2026-08-09", until: "2026-11-06", bucket: "week" };
const HOSTILE = "<img src=x onerror=alert(1)>\u202Eevil\u200Bid\u2028end";

function pricedProject() {
  const base = projectCost();
  return projectCost({
    totals: { ...base.totals, priced: priced(30), preferred: priced(30) },
    byVendor: base.byVendor.map((vendor) => ({ ...vendor, cost: priced(5) })),
    topSessions: base.topSessions.map((session) => ({ ...session, cost: priced(5) })),
  });
}

inEachClaudeSet(() => {
  test("U9 project cost: the priced and preferred tiles say 'your prices', the billed tile does not; accessible name names the version; axe clean", async ({ host }) => {
    const view = await host.showResult("get_project_cost", pricedProject(), { args: PROJECT });

    const priced = view.content.getByRole("group", { name: "Priced" });
    await expect(priced.getByRole("note", { name: NAME })).toHaveText("your prices");
    await expect(view.content.getByRole("group", { name: "Total · preferred basis" }).getByRole("note", { name: NAME })).toBeVisible();
    await expect(view.content.getByRole("group", { name: "Billed" }).getByRole("note")).toHaveCount(0);
    await expect(view.content.getByRole("group", { name: "Reported" }).getByRole("note")).toHaveCount(0);
    await expect(view.content.getByRole("table", { name: "Cost by vendor, then model" }).getByRole("note", { name: NAME }).first()).toBeVisible();
    expect(await view.axeViolations()).toEqual([]);
  });

  test("U9 with no user price version: no tag anywhere", async ({ host }) => {
    const view = await host.showResult("get_project_cost", projectCost(), { args: PROJECT });
    await expect(view.content.getByRole("group", { name: "Billed" })).toBeVisible();
    await expect(view.content.getByRole("note")).toHaveCount(0);
  });

  test("U9 a hostile version id renders as inert, folded text; axe clean", async ({ host }) => {
    const base = projectCost();
    const total = { ...costTotal(30, 10, 10), userPriceVersionIds: [HOSTILE] };
    const view = await host.showResult("get_project_cost", projectCost({ totals: { ...base.totals, priced: total } }), { args: PROJECT });

    const tag = view.content.getByRole("group", { name: "Priced" }).getByRole("note");
    await expect(tag).toHaveText("your prices");
    const name = (await tag.getAttribute("aria-label")) ?? "";
    expect(name).toContain("<img src=x onerror=alert(1)>");
    expect(name).not.toMatch(/[\u202E\u200B\u2028]/u);
    await expect(view.content.locator("img")).toHaveCount(0);
    expect(await view.axeViolations()).toEqual([]);
  });

  test("U10 compare: a priced row and the Together row carry the tag, a billed row does not; axe clean", async ({ host }) => {
    const comparison = costComparison({ total: priced(160), rows: [comparisonRow({ key: "a", label: "alpha", total: priced(100) }), comparisonRow({ key: "b", label: "beta" })] });
    const view = await host.showResult("compare_costs", comparison, { args: { groupBy: "repository", ids: ["a", "b"], since: "2026-11-01", until: "2026-11-09" } });

    const alpha = view.content.getByRole("row").filter({ has: view.content.getByRole("button", { name: "alpha" }) });
    const beta = view.content.getByRole("row").filter({ has: view.content.getByRole("button", { name: "beta" }) });
    await expect(alpha.getByRole("note", { name: NAME }).first()).toHaveText("your prices");
    await expect(beta.getByRole("note")).toHaveCount(0);
    await expect(view.content.locator("tfoot").getByRole("note", { name: NAME }).first()).toBeVisible();
    expect(await view.axeViolations()).toEqual([]);
  });

  test("U11 cost change: the note names the user price versions; axe clean", async ({ host }) => {
    const variance = costVariance({ currencies: [varianceCurrency()], userPriceVersionIds: MINE });
    const view = await host.showResult("explain_cost_change", variance, { args: { groupBy: "repository", id: "github.com/acme/widgets", periodA: variance.periodA, periodB: variance.periodB } });

    await expect(view.content.getByRole("note", { name: NAME }).first()).toHaveText("your prices");
    expect(await view.axeViolations()).toEqual([]);
  });

  test("U14 statement: the user-priced line, its currency's total and tile carry the tag, the billed currency does not; axe clean", async ({ host }) => {
    const base = statement();
    const lines = base.lines.map((line, index) => (index === 0 ? { ...line, userPriced: true as const, priceVersionId: "mine-2026-10" } : line));
    const view = await host.showResult("get_statement", statementAnswer({ statement: { ...base, lines } }), { args: { projectId: "portal", period: "2026-10" } });

    await expect(view.content.getByRole("group", { name: "Total, USD" }).getByRole("note", { name: NAME })).toHaveText("your prices");
    await expect(view.content.getByRole("region", { name: "Statement lines in USD, scrollable" }).getByRole("note", { name: NAME }).first()).toBeVisible();
    await expect(view.content.getByRole("group", { name: "Total, AI Credits" }).getByRole("note")).toHaveCount(0);
    await expect(view.content.getByRole("region", { name: "Statement lines in AI Credits, scrollable" }).getByRole("note")).toHaveCount(0);
    expect(await view.axeViolations()).toEqual([]);
  });

  test("U15 estimate: the range carries the tag; axe clean", async ({ host }) => {
    const view = await host.showResult("estimate_cost", estimate({ userPriceVersionIds: MINE }), { args: { projectId: "portal", activeDays: 10 } });

    await expect(view.content.getByRole("region", { name: "Estimated range" }).getByRole("note", { name: NAME })).toHaveText("your prices");
    expect(await view.axeViolations()).toEqual([]);
  });

  test("U18 savings: a row priced with a user version carries the tag, a bundled-priced one does not; axe clean", async ({ host }) => {
    const mine = { known: true as const, currency: "AI_CREDITS" as const, low: 1, high: 2, basis: "priced" as const, label: "range" as const, priceVersionIds: MINE, userPriceVersionIds: MINE };
    const user = row({ key: "u", kind: "idle-cache-expiry", subject: "claude-sonnet-5.5", perWeek: mine, perWindow: { ...mine, low: 4, high: 8 } });
    const view = await host.showResult("get_savings_report", savingsOutput({ opportunities: [user, { ...claudeRow, key: "c" }], opportunitiesTotal: 2 }), { args: { limit: 3 } });

    await expect(view.content.getByRole("note", { name: NAME })).toHaveCount(1);
    expect(await view.axeViolations()).toEqual([]);
  });
});
