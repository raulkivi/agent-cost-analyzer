// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { expect, openDashboard, test } from "../support/app-fixture.js";

// Phase 17 P3: the left-column list is compact rows that scroll inside the
// column. The old per-row corner marks overflowed it by 6 px and drew a
// horizontal scrollbar. P6/P7 add the Phase 17 exit checks below.
test.use({ viewport: { width: 1440, height: 900 } });

test("P3: the Learn scenario list has no horizontal overflow and compact rows", async ({ page, app }) => {
  await page.goto(app.baseURL);
  const list = page.getByRole("list", { name: "Scenarios" });
  await expect(list.getByRole("button").first()).toBeVisible();

  const { scrollWidth, clientWidth } = await list.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

  const row = await list.locator("li").first().boundingBox();
  expect(row!.height).toBeLessThanOrEqual(56);
});

test("Phase 17 exit: the Dashboard is dense at 1440x900", async ({ page, app }) => {
  await openDashboard(page, app.baseURL);

  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(scrollHeight).toBeLessThanOrEqual(1470);

  const firstTile = await page.locator(".stat-tile").first().boundingBox();
  expect(firstTile!.y).toBeLessThanOrEqual(340);

  const tileHeights = await page.locator(".stat-tile").evaluateAll((tiles) => tiles.map((tile) => tile.getBoundingClientRect().height));
  expect(tileHeights.length).toBeGreaterThan(0);
  for (const height of tileHeights) expect(height).toBeLessThanOrEqual(80);

  const sessionRows = await page
    .getByRole("table", { name: "Most expensive sessions" })
    .locator("tbody tr")
    .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
  expect(sessionRows.length).toBeGreaterThan(0);
  for (const height of sessionRows) expect(height).toBeLessThanOrEqual(30);
});

test("Phase 17 exit: the Learn turns table does not scroll sideways at 1440", async ({ page, app }) => {
  await page.goto(app.baseURL);
  await page.getByRole("button", { name: /Cache Basics: An 8-Turn Session/ }).click();
  const scroller = page.locator(".table-scroll").first();
  await expect(scroller.locator("tbody tr").first()).toBeVisible();

  const { scrollWidth, clientWidth } = await scroller.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

test.describe("at 360px", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  for (const view of ["Learn", "Dashboard"] as const) {
    test(`Phase 17 exit: ${view} has no horizontal page overflow`, async ({ page, app }) => {
      if (view === "Dashboard") {
        await openDashboard(page, app.baseURL);
      } else {
        await page.goto(app.baseURL);
        await expect(page.getByRole("list", { name: "Scenarios" })).toBeVisible();
      }
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  }
});
