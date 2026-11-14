// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { expect, test } from "../support/app-fixture.js";
import { play, presetColorMode, recordScene, Pointer, totalBeatMs, type DemoScene } from "./support/demo-driver.js";

// W1, "Learn mode" (docs/plans/docs-refresh-and-demo-recordings.md §4.1):
// pick a scenario, step through its turns, then the cache-expiry and
// compaction markers. Made-up bundled scenarios only; nothing personal.
const scenario = (page: import("@playwright/test").Page, name: RegExp) => page.getByRole("list", { name: "Scenarios" }).getByRole("button", { name });
const turn = (page: import("@playwright/test").Page, n: number) => page.locator("table tbody tr").nth(n - 1);

export const W1: DemoScene = {
  id: "W1",
  slug: "learn",
  title: "Learn mode",
  steps: [
    {
      label: "Flip the header switch from Light to Dark",
      beatMs: 2200,
      action: (page, pointer) => pointer.click(page.getByRole("radiogroup", { name: "Colour theme" }).locator("label.seg-opt", { hasText: "Dark" })),
    },
    { label: "Pick the cache basics scenario", beatMs: 1200, action: (page, pointer) => pointer.click(scenario(page, /Cache Basics/)) },
    { label: "Step to turn 2", beatMs: 900, action: (page, pointer) => pointer.click(turn(page, 2)) },
    { label: "Step to turn 5", beatMs: 900, action: (page, pointer) => pointer.click(turn(page, 5)) },
    { label: "Pick the scenario with a break over an hour", beatMs: 1200, action: (page, pointer) => pointer.click(scenario(page, /A Break Longer Than/)) },
    { label: "Turn 8 shows the cache expiry", beatMs: 1500, action: (page, pointer) => pointer.click(turn(page, 8)) },
    { label: "Pick the compaction scenario", beatMs: 1200, action: (page, pointer) => pointer.click(scenario(page, /Context Compaction/)) },
    { label: "Turn 3 shows the compaction", beatMs: 1500, action: (page, pointer) => pointer.click(turn(page, 3)) },
  ],
};

test("W1: Learn mode, scenarios and their cache and compaction markers", async ({ page, app }) => {
  expect(totalBeatMs(W1)).toBeLessThan(20_000);
  await presetColorMode(page, "light");
  await page.goto(app.baseURL);
  await expect(page.getByRole("list", { name: "Scenarios" }).getByRole("button").first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "light");
  const pointer = new Pointer(page);
  await pointer.install();

  await recordScene(page, W1, async () => {
  await play(page, W1, pointer);

  // End state: the compaction scenario with its trigger shown and turn 3 selected.
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
  await expect(page.getByRole("heading", { name: "Context Compaction Mid-Session" })).toBeVisible();
  await expect(turn(page, 3)).toHaveAttribute("aria-selected", "true");
  await expect(turn(page, 3)).toContainText("compaction");
  });
});
