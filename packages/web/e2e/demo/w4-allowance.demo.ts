// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/app-fixture.js";
import { assertPrivate, probed } from "./support/privacy-probe.js";
import { DEMO_MAX_BEAT_MS, play, presetColorMode, recordScene, Pointer, totalBeatMs, type DemoScene } from "./support/demo-driver.js";

// W4, "Monthly allowance" (docs/plans/demo-recordings-1.0.md §3.2): Analyze, the muted
// "Set monthly allowance" button, the settings dialog, Save, the gauge ("at least <used> of
// <allowance> AI Credits · near limit"), its details dialog, Escape. Runs on the demo fixture
// home with MS8's seeds (`allowanceSessions`) and no allowance set. Partial coverage ("at least")
// is the default state on purpose: the honesty rule is the point.
//
// ALLOWANCE: the demo home bills 32.46 AI Credits (8 of 9 sessions known) this month. 36 puts that at 90%:
// past the 80% warning, short of 100%, with room if a seed moves a little. The level reads "near limit".
const ALLOWANCE = "36";
const gauge = (page: Page): Locator => page.locator(".allowance-gauge");
const dialog = (page: Page): Locator => page.getByRole("dialog", { name: "Monthly allowance" });

export const W4: DemoScene = {
  id: "W4",
  slug: "allowance",
  title: "Monthly allowance",
  steps: [
    {
      label: "Analyze mode: the muted Set monthly allowance button",
      beatMs: 2000,
      action: async (page, pointer) => {
        await pointer.click(page.getByText("Analyze", { exact: true }));
        await expect(page.getByRole("button", { name: "Set monthly allowance" })).toBeVisible();
        await expect(gauge(page)).not.toContainText("AI Credits");
      },
    },
    {
      label: "Open the settings dialog",
      beatMs: 600,
      action: async (page, pointer) => {
        await pointer.click(page.getByRole("button", { name: "Set monthly allowance" }));
        await expect(dialog(page).getByLabel("Monthly allowance (AI Credits)")).toBeFocused();
      },
    },
    {
      label: "Type the allowance at demo pace",
      beatMs: 900,
      action: async (page) => {
        await dialog(page).getByLabel("Monthly allowance (AI Credits)").pressSequentially(ALLOWANCE, { delay: 220 });
        await expect(dialog(page).getByLabel("Monthly allowance (AI Credits)")).toHaveValue(ALLOWANCE);
      },
    },
    {
      label: "Save",
      beatMs: 600,
      action: async (page, pointer) => {
        await pointer.click(dialog(page).getByRole("button", { name: "Save" }));
        await expect(dialog(page)).toHaveCount(0);
      },
    },
    {
      label: "The gauge: at least the month's AI Credits of the allowance, near limit",
      beatMs: 3000,
      action: async (page) => {
        await expect(gauge(page)).toContainText(`of ${ALLOWANCE} AI Credits`);
        await expect(gauge(page)).toContainText("at least");
        await expect(gauge(page)).toContainText("near limit");
      },
    },
    {
      label: "Click the gauge: the details dialog",
      beatMs: 4200,
      action: async (page, pointer) => {
        await pointer.click(gauge(page));
        const details = dialog(page);
        await expect(details).toBeVisible();
        await expect(details).toContainText("Copilot Chat");
        await expect(details).toContainText("Agent Host");
        await expect(details).toContainText("Not counted");
      },
    },
    {
      label: "Escape: focus returns to the gauge",
      beatMs: 1000,
      action: async (page) => {
        await page.keyboard.press("Escape");
        await expect(dialog(page)).toHaveCount(0);
        await expect(gauge(page)).toBeFocused();
      },
    },
  ],
};

test.use({ demo: true, allowanceSessions: true });

test("W4: set a monthly allowance, read the gauge and its details", async ({ page, app }) => {
  expect(totalBeatMs(W4)).toBeLessThan(DEMO_MAX_BEAT_MS);
  await presetColorMode(page, "dark");
  await page.goto(app.baseURL);
  await expect(page.getByText("Analyze", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
  const pointer = new Pointer(page);
  await pointer.install();

  await recordScene(page, W4, () => play(page, probed(W4), pointer), async () => {
    // End state: the allowance is set, the dialog is closed and the gauge has focus.
    await expect(gauge(page)).toContainText(`of ${ALLOWANCE} AI Credits · near limit`);
    await expect(gauge(page)).toBeFocused();
    await assertPrivate(page);
  });
});
