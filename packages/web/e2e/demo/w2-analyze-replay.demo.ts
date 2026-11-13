// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Page } from "@playwright/test";
import { expect, test } from "../support/app-fixture.js";
import { finish, play, Pointer, totalBeatMs, type DemoScene } from "./support/demo-driver.js";

// W2, "Analyze and replay" (docs/plans/docs-refresh-and-demo-recordings.md
// §4.1): pick a provider and a session, open a turn, replay the session on
// another model and read the Simulated columns. The fixture home's
// two-turn Claude Code session (made-up data, as the R1 scenario).
const MODEL = "claude-opus-5.5";
const session = (page: Page) => page.getByRole("button", { name: /^portal-web/ }).filter({ hasText: /2 turns/ });

export const W2: DemoScene = {
  id: "W2",
  slug: "analyze-replay",
  title: "Analyze and replay",
  steps: [
    { label: "Switch to Analyze", beatMs: 1000, action: (page, pointer) => pointer.click(page.getByText("Analyze", { exact: true })) },
    {
      label: "Pick Claude Code as the log provider",
      beatMs: 1200,
      action: async (page, pointer) => {
        const switched = page.waitForResponse((response) => response.url().endsWith("/api/log-providers/active") && response.ok());
        await pointer.select(page.getByRole("combobox", { name: "Log provider" }), "claude-code");
        await switched;
      },
    },
    { label: "Open a session", beatMs: 1500, action: (page, pointer) => pointer.click(session(page)) },
    { label: "Open a turn in the inspector", beatMs: 1500, action: (page, pointer) => pointer.click(page.locator("table tbody tr").first()) },
    { label: "Replay on another model", beatMs: 2000, action: (page, pointer) => pointer.select(page.getByRole("combobox", { name: "Replay on" }), MODEL) },
    { label: "Read the Simulated columns and the summary strip", beatMs: 2500, action: (page, pointer) => pointer.click(page.getByRole("button", { name: "Replay summary" })) },
    { label: "Close the summary", beatMs: 1000, action: async (page) => page.keyboard.press("Escape") },
  ],
};

test("W2: Analyze a Claude Code session and replay it on another model", async ({ page, app }) => {
  expect(totalBeatMs(W2)).toBeLessThan(20_000);
  await page.goto(app.baseURL);
  await expect(page.getByText("Analyze", { exact: true })).toBeVisible();
  const pointer = new Pointer(page);
  await pointer.install();
  await page.waitForTimeout(800);

  await play(page, W2, pointer);

  // End state: the Simulated columns and the replay strip are on screen.
  await expect(page.getByRole("columnheader", { name: `Simulated ${MODEL}` })).toBeVisible();
  await expect(page.getByRole("region", { name: "Replay summary" })).toContainText(`on ${MODEL}`);
  await finish(page, W2);
});
