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

test("no flash: the attribute is set before <body> is parsed", async ({ page, app }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  // Observes `document` because the init script runs before <html> exists.
  // Notes whether <body> existed when the attribute first appeared. L6
  // measured main.tsx's module script running 30-180 ms after first paint,
  // so only a <head> script set before <body> keeps the first frame in the
  // right scheme. Independent of paint timing.
  await page.addInitScript(() => {
    const w = window as unknown as { __bodyAtSet?: boolean };
    new MutationObserver((_records, observer) => {
      if (document.documentElement?.dataset.colorMode === undefined) return;
      w.__bodyAtSet = document.body !== null;
      observer.disconnect();
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-color-mode"] });
  });
  await page.goto(app.baseURL);
  await expect(page.getByRole("radiogroup", { name: "Colour theme" })).toBeVisible();
  await expect(page.locator(html)).toHaveAttribute("data-color-mode", "dark");
  const bodyAtSet = await page.evaluate(() => (window as unknown as { __bodyAtSet?: boolean }).__bodyAtSet);
  expect(bodyAtSet).toBe(false);
});
