// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Page } from "@playwright/test";
import { expect, test } from "../support/app-fixture.js";
import { AUDIT_READ_SESSION_TITLE } from "../support/fixture-home.mts";
import { assertPrivate, probed } from "./support/privacy-probe.js";
import { DEMO_MAX_BEAT_MS, play, presetColorMode, recordScene, Pointer, totalBeatMs, type DemoScene } from "./support/demo-driver.js";

// W5, "Tool audit with subagent calls" (docs/plans/demo-recordings-1.0.md §3.2): Analyze on the
// VS Code Copilot Chat source, the audit session, the Tool audit tab (the KPI sub-line and the
// Calls by agent split), the Agent filter on Subagents (the Agent column, the runs table with
// an unread run and its reason), then the All sessions audit. Runs on the demo home with the
// audit sessions (ST12's child-log calls, made-up data): no frame reads "fixture-…" (D36).
const PROVIDER = "vscode";
const UNREAD_REASON = /this subagent tool writes no log the analyzer reads/;
const callsTable = (page: Page) => page.getByRole("table", { name: "Tool calls" });
const runsTable = (page: Page) => page.getByRole("table", { name: "Subagent runs" });
const agentFilter = (page: Page) => page.getByRole("group", { name: "Agent", exact: true });
const toolsKpi = (page: Page) => page.getByRole("group", { name: "Tool calls", exact: true }).first();

export const W5: DemoScene = {
  id: "W5",
  slug: "tool-audit",
  title: "Tool audit with subagent calls",
  steps: [
    { label: "Switch to Analyze", beatMs: 200, action: (page, pointer) => pointer.click(page.getByText("Analyze", { exact: true })) },
    {
      label: "Source: VS Code Copilot Chat",
      beatMs: 400,
      action: async (page, pointer) => {
        await pointer.select(page.getByRole("combobox", { name: "Log provider" }), PROVIDER);
        await expect(page.getByRole("button", { name: AUDIT_READ_SESSION_TITLE })).toBeVisible();
      },
    },
    {
      label: "Open the subagent session",
      beatMs: 1000,
      action: async (page, pointer) => {
        await pointer.click(page.getByRole("button", { name: AUDIT_READ_SESSION_TITLE }));
        await expect(page.getByRole("heading", { name: AUDIT_READ_SESSION_TITLE })).toBeVisible();
      },
    },
    {
      label: "Open the Tool audit tab: the KPI sub-line and Calls by agent",
      beatMs: 3000,
      action: async (page, pointer) => {
        await pointer.click(page.locator("label.seg-opt", { hasText: "Tool audit" }));
        await expect(toolsKpi(page)).toContainText("incl. 3 calls from 1 of 2 subagent runs");
        await expect(page.getByText("Calls by agent").first()).toBeVisible();
      },
    },
    {
      label: "Agent filter: Subagents",
      beatMs: 1500,
      action: async (page, pointer) => {
        await pointer.click(agentFilter(page).getByRole("button", { name: "Subagents" }));
        await expect(agentFilter(page).getByRole("button", { name: "Subagents" })).toHaveAttribute("aria-pressed", "true");
        await expect(callsTable(page).getByRole("columnheader", { name: "Agent" })).toBeVisible();
        // Status chips default to failed-first: only the failed call shows until Succeeded is on.
        await expect(callsTable(page).locator("tbody tr")).toHaveCount(1);
        await expect(callsTable(page).locator("tbody tr").first()).toContainText("searchSubagent");
      },
    },
    {
      label: "Succeeded chip: all 3 subagent calls",
      beatMs: 2500,
      action: async (page, pointer) => {
        const chip = page.getByRole("button", { name: /^Succeeded/ });
        await pointer.click(chip);
        await expect(chip).toHaveAttribute("aria-pressed", "true");
        const body = callsTable(page).locator("tbody tr");
        await expect(body).toHaveCount(3);
        await expect(callsTable(page).getByRole("columnheader", { name: "Agent" })).toBeVisible();
      },
    },
    {
      label: "Subagent runs: the unread run and its reason",
      beatMs: 3000,
      action: async (page, pointer) => {
        const unread = runsTable(page).locator("tbody tr.audit-run--unread");
        await pointer.glideTo(unread);
        await expect(unread).toHaveCount(1);
        await expect(unread).toContainText(UNREAD_REASON);
      },
    },
    {
      label: "All sessions audit: main and subagent totals, the subagent calls column",
      beatMs: 4000,
      action: async (page, pointer) => {
        await pointer.click(page.locator("label.seg-opt", { hasText: "All sessions" }));
        await expect(page.getByRole("group", { name: "Sessions with unread runs" })).toContainText("1 of");
        const sessions = page.getByRole("table", { name: "Sessions" });
        await expect(sessions.getByRole("columnheader", { name: "Subagent calls" })).toBeVisible();
        await pointer.glideTo(sessions.locator("tbody tr", { hasText: AUDIT_READ_SESSION_TITLE }));
      },
    },
  ],
};

test.use({ demo: true, auditSessions: true });

test("W5: the Tool audit tab splits subagent calls, filters them and rolls them up", async ({ page, app }) => {
  expect(totalBeatMs(W5)).toBeLessThan(DEMO_MAX_BEAT_MS);
  await presetColorMode(page, "dark");
  await page.goto(app.baseURL);
  await expect(page.getByText("Analyze", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
  const pointer = new Pointer(page);
  await pointer.install();

  await recordScene(page, W5, () => play(page, probed(W5), pointer), async () => {
    // End state: the All sessions audit, with the audit session's unread run counted.
    const sessions = page.getByRole("table", { name: "Sessions" });
    await expect(sessions.locator("tbody tr", { hasText: AUDIT_READ_SESSION_TITLE })).toContainText("1 run unread");
    await expect(page.getByText(/Their subagent calls are unknown, not 0/)).toBeVisible();
    await assertPrivate(page);
  });
});
