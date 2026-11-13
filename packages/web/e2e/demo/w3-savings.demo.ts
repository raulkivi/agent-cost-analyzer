// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Page } from "@playwright/test";
import { expect, test } from "../support/app-fixture.js";
import { finish, play, Pointer, totalBeatMs, type DemoScene } from "./support/demo-driver.js";

// W3, "Savings" (docs/plans/docs-refresh-and-demo-recordings.md §4.1):
// Dashboard, Savings tab, the 7/30/90 day windows, then a row's detail and
// Open in Analyze. The fixture home's Claude Code session of 2026-10-30
// (an idle gap past the cache and a model switch); made-up data.
const tab = (page: Page) => page.getByTestId("savings-tab");
const windowSelect = (page: Page) => tab(page).getByRole("combobox", { name: "Window" });
const rows = (page: Page) => tab(page).getByTestId("savings-row");

export const W3: DemoScene = {
  id: "W3",
  slug: "savings",
  title: "Savings",
  steps: [
    { label: "Switch to Analyze", beatMs: 800, action: (page, pointer) => pointer.click(page.getByText("Analyze", { exact: true })) },
    {
      label: "Open the Dashboard",
      beatMs: 1200,
      action: async (page, pointer) => {
        const view = page.getByRole("combobox", { name: /^view$/i });
        if (await view.isVisible().catch(() => false)) await pointer.select(view, "Dashboard");
        else await pointer.click(page.locator("label.seg-opt", { hasText: "Dashboard" }));
      },
    },
    {
      label: "Open the Savings tab",
      beatMs: 1800,
      action: async (page, pointer) => {
        const view = page.getByRole("combobox", { name: "Dashboard view" });
        if (await view.isVisible().catch(() => false)) await pointer.select(view, "Savings");
        else await pointer.click(page.getByRole("radiogroup", { name: "Dashboard view" }).locator("label.seg-opt", { hasText: "Savings" }));
      },
    },
    { label: "Widen the window to 90 days", beatMs: 1500, action: (page, pointer) => pointer.select(windowSelect(page), "Last 90 days") },
    { label: "Narrow it to 7 days", beatMs: 1500, action: (page, pointer) => pointer.select(windowSelect(page), "Last 7 days") },
    { label: "Back to 30 days", beatMs: 1500, action: (page, pointer) => pointer.select(windowSelect(page), "Last 30 days") },
    {
      label: "Open the top row's detail",
      beatMs: 2200,
      action: async (page, pointer) => {
        await expect(rows(page).first()).toBeVisible();
        await pointer.click(rows(page).first().getByRole("button"));
      },
    },
    {
      label: "Open the session in Analyze",
      beatMs: 1800,
      action: (page, pointer) => pointer.click(tab(page).getByRole("region", { name: "Savings detail" }).getByRole("button", { name: /^Open in Analyze/ }).or(tab(page).getByRole("region", { name: "Savings detail" }).getByRole("link", { name: /^Open in Analyze/ }))),
    },
  ],
};

test("W3: the Savings tab, its windows and Open in Analyze", async ({ page, app }) => {
  expect(totalBeatMs(W3)).toBeLessThan(20_000);
  await page.goto(app.baseURL);
  await expect(page.getByText("Analyze", { exact: true })).toBeVisible();
  const pointer = new Pointer(page);
  await pointer.install();
  await page.waitForTimeout(800);

  await play(page, W3, pointer);

  // End state: Analyze shows the opened session's turns.
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  await finish(page, W3);
});
