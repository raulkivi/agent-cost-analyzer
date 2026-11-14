// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { expect, test } from "../support/app-fixture.js";

// Phase 17 L2: the standalone app's Auto/Light/Dark switch sets
// html[data-color-mode]; Auto follows the OS scheme.
const html = "html";

test("Auto follows the emulated OS scheme, live", async ({ page, app }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(app.baseURL);
  await expect(page.locator(html)).toHaveAttribute("data-color-mode", "dark");
  await expect(page.getByRole("radio", { name: "Auto" })).toBeChecked();

  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator(html)).toHaveAttribute("data-color-mode", "light");
});

test("choosing Light persists across a reload, whatever the OS says", async ({ page, app }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(app.baseURL);
  await page.getByRole("radiogroup", { name: "Colour theme" }).getByText("Light").click();
  await expect(page.locator(html)).toHaveAttribute("data-color-mode", "light");

  await page.reload();
  await expect(page.locator(html)).toHaveAttribute("data-color-mode", "light");
  await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
});

test("no flash: the attribute is set before React renders anything", async ({ page, app }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  // Observes `document` because the init script runs before <html> exists.
  // Notes how much of the app existed when the attribute first appeared.
  // Zero children in #root means it was set before the first render, so no
  // frame can paint the wrong scheme. Independent of paint timing.
  await page.addInitScript(() => {
    const w = window as unknown as { __rootChildrenAtSet?: number };
    new MutationObserver((_records, observer) => {
      if (document.documentElement.dataset.colorMode === undefined) return;
      w.__rootChildrenAtSet = document.getElementById("root")?.childElementCount ?? 0;
      observer.disconnect();
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-color-mode"] });
  });
  await page.goto(app.baseURL);
  await expect(page.getByRole("radiogroup", { name: "Colour theme" })).toBeVisible();
  const children = await page.evaluate(() => (window as unknown as { __rootChildrenAtSet?: number }).__rootChildrenAtSet);
  expect(children).toBe(0);
});
