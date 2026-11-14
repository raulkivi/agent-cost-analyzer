// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { expect, openDashboard, test } from "../support/app-fixture.js";

// Phase 17 P3: the left-column list is compact rows that scroll inside the
// column. The old per-row corner marks overflowed it by 6 px and drew a
// horizontal scrollbar. P6/P7 add the Phase 17 exit checks below.
test.use({ viewport: { width: 1440, height: 900 } });

// The light and dark Playwright projects run these budgets in both ledger
// colour modes (Auto follows the emulated scheme).
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

  // L6 found the All sessions audit's Sessions table pushing the page wider.
  for (const view of ["Learn", "Dashboard", "All sessions"] as const) {
    test(`Phase 17 exit: ${view} has no horizontal page overflow`, async ({ page, app }) => {
      if (view === "Dashboard") {
        await openDashboard(page, app.baseURL);
      } else if (view === "All sessions") {
        await page.goto(app.baseURL);
        await page.getByText("Analyze", { exact: true }).click();
        await page.getByRole("combobox", { name: /^view$/i }).selectOption({ label: "All sessions" });
        await expect(page.getByRole("table", { name: "Sessions" })).toBeVisible();
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

  // L6: the ledger's wider mono labels pushed Compare's Details buttons 10-21px
  // past the scroll box's edge, so they looked cut off.
  test("Phase 17 exit: Compare's table fits without sideways scroll", async ({ page, app }) => {
    await openDashboard(page, app.baseURL);
    await page.getByRole("combobox", { name: "Dashboard view" }).selectOption({ label: "Compare" });
    const scroller = page.locator(".cost-compare-scroll");
    await expect(scroller.getByRole("button", { name: /Details/ }).first()).toBeVisible();

    const { scrollWidth, clientWidth } = await scroller.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});

// Step 13.8 owner review: the Vendors tab sat in the ~290px side column, so
// model names wrapped onto three lines and the Misses column scrolled away.
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 360, height: 800 },
]) {
  test(`Vendors tab fits its column without wrapping model names at ${viewport.width}px`, async ({ page, app }) => {
    await page.setViewportSize(viewport);
    await page.goto(app.baseURL);
    await page.getByRole("button", { name: /Cache TTL: A Break Longer Than an Hour/ }).click();
    // Below the wide layout the right column sits in the Details drawer.
    const details = page.getByRole("button", { name: "Details", exact: true });
    if (await details.isVisible()) await details.click();
    await page.locator("label:has(input[value=vendors])").click();
    const tab = page.locator(".vendors-tab");
    await expect(tab.getByRole("heading").first()).toBeVisible();

    const overflow = await tab.evaluate((element) => ({
      tab: [element.scrollWidth, element.clientWidth] as const,
      page: [document.documentElement.scrollWidth, document.documentElement.clientWidth] as const,
      inner: [...element.querySelectorAll("*")].filter((child) => !child.closest(".sr-only") && child.scrollWidth > child.clientWidth + 1).map((child) => child.className || child.tagName),
    }));
    expect(overflow.tab[0]).toBeLessThanOrEqual(overflow.tab[1]);
    expect(overflow.page[0]).toBeLessThanOrEqual(overflow.page[1]);
    expect(overflow.inner).toEqual([]);

    // A model name is a single line: its height is about one line of its font.
    const names = await tab.getByRole("heading").evaluateAll((headings) =>
      headings.map((heading) => ({ height: heading.getBoundingClientRect().height, line: parseFloat(getComputedStyle(heading).lineHeight) || 20 })),
    );
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name.height).toBeLessThanOrEqual(name.line * 1.5);
  });
}
