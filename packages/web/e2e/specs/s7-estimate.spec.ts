import { axeViolations } from "../support/axe.js";
import { chooseOption, expect, openDashboard, selectListValue, test } from "../support/app-fixture.js";

// Scenario S7, "Estimate" (plan §12.4.2, board 4; step 15.12): Billing →
// Estimate → 20 planned days, 12-week history. Passes when it shows a
// p50–p90 range labelled "Estimate", at today's prices, equal to the
// fixture's expected range, and no single number.
//
// The fixture's Mobile app project has six pi sessions on six days in
// October, each priced at today's prices; the 4-week window (from Oct 10)
// holds four of them, too few for a range.

test("S7: an estimate is a labelled range at today's prices, never one number", async ({ page, app }) => {
  await openDashboard(page, app.baseURL);
  await selectListValue(page, "Project", /Mobile app/);
  await chooseOption(page, "Dashboard view", "Billing");

  const panel = page.getByRole("region", { name: "Next piece of work" });
  await expect(panel.getByText("Estimate · at today's prices")).toBeVisible();
  await expect(panel.getByRole("spinbutton", { name: "Planned active days" })).toHaveValue("20");
  await expect(panel.getByRole("radiogroup", { name: "History window" }).getByRole("radio", { name: "12 weeks" })).toBeChecked();

  const expected = await (await page.request.get(`${app.baseURL}/api/estimates?projectId=mobile&activeDays=20&historyWeeks=12`)).json();
  expect(expected).toMatchObject({ label: "estimate", pricing: "today", history: { knownUnits: 6 } });
  expect(expected.range.p50).toBeLessThan(expected.range.p90);
  const credits = (usd: number) => (usd * 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const figure = panel.getByRole("img", { name: /^Estimate at today's prices/ });
  await expect(figure).toHaveAccessibleName(new RegExp(`^Estimate at today's prices: ${credits(expected.range.p50)} to ${credits(expected.range.p90)} AI Credits`));
  await expect(panel.getByText(`p50 ${credits(expected.range.p50)}`)).toBeVisible();
  await expect(panel.getByText(`p90 ${credits(expected.range.p90)}`)).toBeVisible();
  await expect(panel.getByText(/A range, never one number\. From 6 active days with a known cost/)).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  // Fewer days, the shorter window: asked again; thin history gives the reason, no range.
  await panel.getByRole("radiogroup", { name: "History window" }).locator("label.seg-opt", { hasText: "4 weeks" }).click();
  await expect(panel.getByText(/an estimate needs at least 5/)).toBeVisible();
  await expect(panel.getByRole("img", { name: /^Estimate/ })).toHaveCount(0);
});
