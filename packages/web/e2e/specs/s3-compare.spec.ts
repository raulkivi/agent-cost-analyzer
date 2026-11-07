// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { axeViolations } from "../support/axe.js";
import { chooseOption, expect, openDashboard, selectListValue, test } from "../support/app-fixture.js";

// Scenario S3, "Compare" (plan §12.4.2, boards 2a and 2b): select two
// projects → Compare tab → resize to 640 px → open a row's Details →
// Escape. Passes when the table's measures equal the fixture's, only the
// priority columns show at 640 px, and focus returns to the Details button
// after Escape.
//
// Figures are the fixture home's (support/fixture-home.mts) over the last 90
// days (2026-08-09 to 2026-11-06), in AI Credits at 1 AI Credit = $0.01.
// Customer portal had nothing in the previous 90 days, so its change is
// unknown, never "from 0"; Billing service's previous period is pi's $0.01.
const HEADERS = ["Project", "Total (AI Credits)", "Change", "Per session (AI Credits)", "Per active day (AI Credits)", "Share", "Cache-hit ratio", "Output share", "Coverage"];
const EXPECTED = {
  "Customer portal": ["30.95", "unknown", "6.19", "6.19", "87.8%", "60.0%", "5.1%", "86%"],
  "Billing service": ["4.30", "+330.0%", "1.43", "1.43", "12.2%", "52.6%", "6.9%", "67%"],
  Selection: ["35.25", "unknown", "4.41", "", "100.0%", "", "", "80%"],
};

async function readTable(table: ReturnType<import("@playwright/test").Page["getByRole"]>) {
  const rows: Record<string, string[]> = {};
  for (const row of await table.locator("tbody tr, tfoot tr").all()) {
    const name = ((await row.locator("th").textContent()) ?? "").trim();
    rows[name] = (await row.locator("td").allTextContents()).map((cell) => cell.trim());
  }
  return rows;
}

test("S3: compare two projects, then at 640 px with a row's details", async ({ page, app }) => {
  await openDashboard(page, app.baseURL);
  await selectListValue(page, "Project", /Customer portal/);
  await selectListValue(page, "Project", /Billing service/, true);
  await chooseOption(page, "Dashboard view", "Compare");

  const table = page.getByRole("table", { name: "Compare 2 projects" });
  await expect(table).toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(2);
  expect(await table.locator("thead th").allTextContents()).toEqual(HEADERS);
  await expect.poll(() => readTable(table)).toEqual(EXPECTED);
  await expect(page.getByText(/Billing service: 67% of turns have a known cost/)).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.setViewportSize({ width: 640, height: 900 });
  await expect(table.locator("thead th")).toHaveText(["Project", "Total (AI Credits)", "Change", "Coverage", "Details"]);
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect.poll(() => readTable(table)).toEqual({
    "Customer portal": ["30.95", "unknown", "86%", "Details"],
    "Billing service": ["4.30", "+330.0%", "67%", "Details"],
    Selection: ["35.25", "unknown", "80%", ""],
  });

  const details = page.getByRole("button", { name: "Details for Customer portal" });
  await details.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("region", { name: "Customer portal" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("Per session (5 sessions)6.19");
  await expect(drawer).toContainText("Share of selection87.8%");
  expect(await axeViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(details).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
