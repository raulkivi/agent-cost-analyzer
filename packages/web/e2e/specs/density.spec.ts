// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { expect, test } from "../support/app-fixture.js";

// Phase 17 P3: the left-column list is compact rows that scroll inside the
// column. The old per-row corner marks overflowed it by 6 px and drew a
// horizontal scrollbar. P7 extends this spec with the other density checks.
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
