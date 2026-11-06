import { axeViolations } from "../support/axe.js";
import { chooseOption, expect, openDashboard, selectListValue, test } from "../support/app-fixture.js";

// Scenario S2, "One project over time" (plan §12.4.2, board 1): select the
// project, week buckets, last 90 days → Tab to the price marker → its
// tooltip opens → Escape closes it → View as table. Passes when the tooltip
// shows the old and new unit prices and the source, the table equals the
// chart, and the week with no priced turns reads "unknown" and is a gap.
//
// The fixture's documented price change is Claude Sonnet 5.5's cache-read
// cut on 2026-10-07 (the bundled anthropic-api book), where the board's
// sample shows Sep 1. Figures are the fixture home's (support/fixture-home.mts),
// in AI Credits at 1 AI Credit = $0.01, rounded as the UI rounds them.
const EXPECTED_WEEKS: Record<string, string> = {
  "Week of Aug 3, 2026": "0.00",
  "Week of Aug 10, 2026": "0.00",
  "Week of Aug 17, 2026": "0.00",
  "Week of Aug 24, 2026": "0.00",
  "Week of Aug 31, 2026": "0.00",
  "Week of Sep 7, 2026": "0.00",
  // A Claude Code turn before the price book's first price: no known cost.
  "Week of Sep 14, 2026": "unknown",
  "Week of Sep 21, 2026": "0.00",
  "Week of Sep 28, 2026": "0.00",
  // Claude Code, priced on anthropic-api ($0.12 + $0.016).
  "Week of Oct 5, 2026": "13.60",
  // Claude Code after the cut ($0.027).
  "Week of Oct 12, 2026": "2.70",
  // pi, reported $0.05.
  "Week of Oct 19, 2026": "5.00",
  // Copilot, billed 7.33953 + 2.30782 AI Credits.
  "Week of Oct 26, 2026": "9.65",
  "Week of Nov 2, 2026": "0.00",
};

test("S2: one project over time, with a price marker and the table view", async ({ page, app }) => {
  await openDashboard(page, app.baseURL);
  await selectListValue(page, "Project", /Customer portal/);
  await chooseOption(page, "Dashboard view", "Cost over time");
  await chooseOption(page, "Bucket", "Week");
  await chooseOption(page, "Date range", "Last 90 days");

  const total = page.getByRole("group", { name: "Total cost" });
  await expect(total).toContainText("30.95 AI Credits");
  await expect(total).toContainText("6 of 7 turns known");
  await expect(page.getByText(/Some turns have no known cost/)).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  // Tab from the last filter to the marker.
  await page.getByRole("radiogroup", { name: "Pricing" }).getByRole("radio", { name: "As of use" }).focus();
  const marker = page.getByRole("button", { name: /^Price · claude-sonnet-5\.5/ });
  for (let presses = 0; presses < 40 && !(await marker.evaluate((element) => element === document.activeElement)); presses += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(marker).toBeFocused();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Price change · Oct 7, 2026");
  await expect(tooltip.getByRole("row", { name: /Cached input/ })).toHaveText(/Cached input\s*\$0\.20\s*\$0\.10\s*−50%/);
  await expect(tooltip).toContainText("Anthropic API");
  await expect(tooltip).toContainText("Sources: anthropic-api-pricing-table");
  await expect(marker).toHaveAccessibleDescription(/cached input \$0\.20 to \$0\.10 per million tokens/);
  expect(await axeViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
  await expect(marker).toBeFocused();

  // The chart, read bucket by bucket with the keyboard, and the gap drawn as one.
  const chart = page.getByRole("group", { name: /^Cost over time, Customer portal, weekly/ });
  await expect(chart.locator("[data-gap]")).toHaveAttribute("data-gap", "2026-W38");
  await chart.focus();
  await page.keyboard.press("Home");
  const fromChart: Record<string, string> = {};
  for (let index = 0; index < Object.keys(EXPECTED_WEEKS).length; index += 1) {
    const readout = page.getByRole("tooltip");
    const title = (await readout.locator(".chart-tooltip-title").textContent()) ?? "";
    fromChart[title] = ((await readout.locator(".chart-tooltip-row span").last().textContent()) ?? "").trim();
    await page.keyboard.press("ArrowRight");
  }
  expect(fromChart).toEqual(EXPECTED_WEEKS);
  await page.keyboard.press("Escape");

  // View as table: the same figures, the gap as "unknown", the price change in a row of its own.
  await page.getByRole("button", { name: "View as table" }).first().click();
  const table = page.getByRole("table", { name: /^Cost over time, Customer portal/ });
  const fromTable: Record<string, string> = {};
  for (const row of await table.locator("tbody tr").all()) {
    const header = ((await row.locator("th").textContent()) ?? "").trim();
    if (!header.startsWith("Week of")) continue;
    fromTable[header] = ((await row.locator("td").first().textContent()) ?? "").trim();
  }
  expect(fromTable).toEqual(EXPECTED_WEEKS);
  expect(fromTable["Week of Sep 14, 2026"]).not.toBe("0.00");
  await expect(table.getByRole("row", { name: /Price change Oct 7, 2026/ })).toContainText("claude-sonnet-5.5 (Anthropic API)");
  expect(await axeViolations(page)).toEqual([]);
});
