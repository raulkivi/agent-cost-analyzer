// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Page } from "@playwright/test";
import { expect, test } from "../support/app-fixture.js";
import { assertPrivate, probed } from "./support/privacy-probe.js";
import { DEMO_MAX_BEAT_MS, play, presetColorMode, recordScene, Pointer, totalBeatMs, type DemoScene } from "./support/demo-driver.js";

// W2, "Analyze and replay" (docs/plans/demo-recordings-1.0.md §3.3, extended by DR12 for C15):
// a Claude Code session whose first turn started a subagent run. Hover the Turn-cell marker
// (tokens and priced cost from the run), read the Explanation's Subagent runs block, then replay
// on another model and read the Simulated columns and the runs the replay left out. Runs on the
// demo fixture home (made-up data, realistic model names).
const MODEL = "claude-opus-5.5";
const session = (page: Page) => page.getByRole("button", { name: /^portal-api/ }).filter({ hasText: /2 turns/ });
const marker = (page: Page) => page.locator("table tbody .subagent-marker[role=img]");
const runsBlock = (page: Page) => page.getByRole("region", { name: "Subagent runs this turn" });
const summary = (page: Page) => page.getByRole("region", { name: "Replay summary" });

export const W2: DemoScene = {
  id: "W2",
  slug: "analyze-replay",
  title: "Analyze and replay",
  steps: [
    { label: "Switch to Analyze", beatMs: 700, action: (page, pointer) => pointer.click(page.getByText("Analyze", { exact: true })) },
    {
      label: "Pick Claude Code as the log provider",
      beatMs: 900,
      action: async (page, pointer) => {
        const switched = page.waitForResponse((response) => response.url().endsWith("/api/log-providers/active") && response.ok());
        await pointer.select(page.getByRole("combobox", { name: "Log provider" }), "claude-code");
        await switched;
      },
    },
    {
      label: "Open the session with subagent runs",
      beatMs: 1200,
      action: async (page, pointer) => {
        await pointer.click(session(page));
        await expect(marker(page)).toHaveCount(1);
        // The session opens on turn 1, which started no run.
        await expect(runsBlock(page)).toHaveCount(0);
      },
    },
    {
      label: "Hover the Turn-cell marker on turn 2: tokens and priced cost from the run",
      beatMs: 1500,
      action: async (page, pointer) => {
        await pointer.glideTo(marker(page));
        await marker(page).hover();
        // The words are a native title tooltip (not shown in the take); assert them, don't wait on the tooltip.
        await expect(marker(page)).toHaveAttribute("title", /^incl\. .* tokens, \$.* priced, from 1 subagent run$/);
      },
    },
    {
      label: "Open turn 2: the Explanation's Subagent runs block",
      beatMs: 3000,
      action: async (page, pointer) => {
        await pointer.click(page.locator("table tbody tr").filter({ has: page.locator(".subagent-marker") }));
        await expect(runsBlock(page).getByRole("listitem")).toHaveCount(1);
        await expect(runsBlock(page).getByRole("group", { name: "Turn totals" })).toContainText("Subagent runs");
      },
    },
    {
      label: "Replay on another model",
      beatMs: 2000,
      action: async (page, pointer) => {
        await pointer.select(page.getByRole("combobox", { name: "Replay on" }), MODEL);
        await expect(page.getByRole("columnheader", { name: `Simulated ${MODEL}` })).toBeVisible();
      },
    },
    {
      label: "Read the replay summary: the runs it left out",
      beatMs: 3000,
      action: async (page, pointer) => {
        await pointer.click(page.getByRole("button", { name: "Replay summary" }));
        await expect(summary(page)).toContainText(`on ${MODEL}`);
        await expect(summary(page)).toContainText("1 subagent run not replayed");
      },
    },
  ],
};

test.use({ demo: true });

test("W2: Analyze a Claude Code session with subagent runs and replay it on another model", async ({ page, app }) => {
  expect(totalBeatMs(W2)).toBeLessThan(DEMO_MAX_BEAT_MS);
  await presetColorMode(page, "dark");
  await page.goto(app.baseURL);
  await expect(page.getByText("Analyze", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
  const pointer = new Pointer(page);
  await pointer.install();

  await recordScene(page, W2, () => play(page, probed(W2), pointer), async () => {
    // End state: the Simulated columns, the replay strip and the runs it left out are on screen.
    await expect(page.getByRole("columnheader", { name: `Simulated ${MODEL}` })).toBeVisible();
    await expect(summary(page)).toContainText(`on ${MODEL}`);
    await expect(summary(page)).toContainText("subagent run not replayed");
    await assertPrivate(page);
  });
});
