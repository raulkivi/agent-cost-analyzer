// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { homedir, userInfo } from "node:os";
import type { Page } from "@playwright/test";
import { findForbidden, forbiddenTerms } from "../../../vscode-extension/scripts/demo/privacy-probe.mts";
import { expect, test } from "../support/app-fixture.js";
import { play, presetColorMode, recordScene, Pointer, totalBeatMs, type DemoScene } from "./support/demo-driver.js";

// W3, "Savings" (docs/plans/demo-recordings-1.0.md §3.3): Dashboard, Savings
// tab, 90 then 30 days, the top row's sessions, the unused-tools row's tool
// list, the pi row ranked last ("Not priced" and its reason), Open in
// Analyze. Runs on the demo fixture home (DR1): made-up data, realistic
// model names, so no frame reads "fixture-…".
const tab = (page: Page) => page.getByTestId("savings-tab");
const windowSelect = (page: Page) => tab(page).getByRole("combobox", { name: "Window" });
const rows = (page: Page) => tab(page).getByTestId("savings-row");
const detail = (page: Page) => tab(page).getByRole("region", { name: "Savings detail" });
// The first row in API order: model switches (USD).
const topRow = (page: Page) => rows(page).filter({ hasText: "Model switched" }).first();
const unusedToolsRow = (page: Page) => rows(page).filter({ hasText: "acmedocs" });
// The pi row is the last ranked row and has no price.
const piRow = (page: Page) => rows(page).last();

// The privacy probe: after every step, nothing on screen may carry an owner-private term
// (home directory, user name, DEMO_FORBIDDEN) or a shared-fixture "fixture-" model name.
async function assertPrivate(page: Page): Promise<void> {
  const text = await page.evaluate(() => document.body.innerText);
  const terms = [...forbiddenTerms(process.env.DEMO_FORBIDDEN, { homedir: homedir(), username: userInfo().username }), "fixture-"];
  const hits = findForbidden([{ source: "app page", text: `${text}\n${page.url()}` }], terms);
  if (hits.length > 0) throw new Error(`Forbidden text on screen: ${hits.map((hit) => `${hit.match} in ${hit.source}`).join(", ")}`);
}

const probed = (scene: DemoScene): DemoScene => ({
  ...scene,
  steps: scene.steps.map((step) => ({
    ...step,
    action: async (page, pointer) => {
      await step.action(page, pointer);
      await assertPrivate(page);
    },
  })),
});

export const W3: DemoScene = {
  id: "W3",
  slug: "savings",
  title: "Savings",
  steps: [
    { label: "Switch to Analyze", beatMs: 500, action: (page, pointer) => pointer.click(page.getByText("Analyze", { exact: true })) },
    {
      label: "Open the Dashboard",
      beatMs: 700,
      action: async (page, pointer) => {
        const view = page.getByRole("combobox", { name: /^view$/i });
        if (await view.isVisible().catch(() => false)) await pointer.select(view, "Dashboard");
        else await pointer.click(page.locator("label.seg-opt", { hasText: "Dashboard" }));
      },
    },
    {
      label: "Open the Savings tab",
      beatMs: 1000,
      action: async (page, pointer) => {
        const view = page.getByRole("combobox", { name: "Dashboard view" });
        if (await view.isVisible().catch(() => false)) await pointer.select(view, "Savings");
        else await pointer.click(page.getByRole("radiogroup", { name: "Dashboard view" }).locator("label.seg-opt", { hasText: "Savings" }));
      },
    },
    { label: "Widen the window to 90 days", beatMs: 800, action: (page, pointer) => pointer.select(windowSelect(page), "Last 90 days") },
    {
      label: "Back to 30 days",
      beatMs: 800,
      action: (page, pointer) => pointer.select(windowSelect(page), "Last 30 days"),
    },
    {
      label: "Open the top row: its sessions with title, id, date and saving",
      beatMs: 2000,
      action: async (page, pointer) => {
        await expect(topRow(page)).toBeVisible();
        await pointer.click(topRow(page).getByRole("button"));
      },
    },
    {
      label: "Open the unused-tools row: the per-tool list",
      beatMs: 2000,
      action: (page, pointer) => pointer.click(unusedToolsRow(page).getByRole("button")),
    },
    {
      label: "Scroll to the pi row ranked last: Not priced and its reason",
      beatMs: 2200,
      action: (page, pointer) => pointer.click(piRow(page).getByRole("button")),
    },
    {
      label: "Open the session in Analyze",
      beatMs: 1000,
      action: (page, pointer) => pointer.click(detail(page).getByRole("button", { name: /^Open in Analyze/ }).or(detail(page).getByRole("link", { name: /^Open in Analyze/ })).first()),
    },
  ],
};

test.use({ demo: true });

test("W3: the Savings tab, its windows and Open in Analyze", async ({ page, app }) => {
  expect(totalBeatMs(W3)).toBeLessThan(20_000);
  await presetColorMode(page, "dark");
  await page.goto(app.baseURL);
  await expect(page.getByText("Analyze", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
  const pointer = new Pointer(page);
  await pointer.install();

  await recordScene(page, W3, async () => {
  await play(page, probed(W3), pointer);

  // End state: Analyze shows the opened session's turns.
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  await expect(page.getByText("Tidy the notes folder").first()).toBeVisible();
  await assertPrivate(page);
  });
});
