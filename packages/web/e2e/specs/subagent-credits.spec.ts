// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { axeViolations } from "../support/axe.js";
import { expect, openDashboard, selectListValue, test } from "../support/app-fixture.js";
import { SUBAGENT_RUN_MODEL, SUBAGENT_RUNS_CREDITS, SUBAGENT_SESSION_CREDITS, SUBAGENT_SESSION_TITLE } from "../support/fixture-home.mts";

// Step 10.19 (SA16), the standalone half of plan §7: a classic Copilot Chat
// session whose turns started subagent runs. The fixture home's session
// (support/fixture-home.mts) has an "Explore" run on turn 1 (1.10 AI Credits)
// and a searchSubagent run on turn 2 that recorded none (0.00, D8). Passes when
// the turns table marks both turns with the words in their accessible names,
// the Explanation panel lists the runs, the figures are the API's, and the
// Dashboard's model view counts the run's model.

const PROVIDER = "vscode";

// The axe checks cover the turns table and the Explanation panel, not the
// session list beside them: its cards are named by the title alone
// (label-content-name-mismatch) and the advice checkbox is under 24 px
// (target-size), both before step 10.19 and outside this scenario.
const AXE = { exclude: ['ul[aria-label="Sessions"]'] };

async function openSession(page: import("@playwright/test").Page, baseURL: string): Promise<void> {
  await page.goto(baseURL);
  await page.getByText("Analyze", { exact: true }).click();
  const switched = page.waitForResponse((response) => response.url().endsWith("/api/log-providers/active") && response.ok());
  await page.getByRole("combobox", { name: "Log provider" }).selectOption(PROVIDER);
  await switched;
  await page.getByRole("button", { name: SUBAGENT_SESSION_TITLE }).click();
  await expect(page.getByRole("heading", { name: SUBAGENT_SESSION_TITLE })).toBeVisible();
}

test("10.19: the turns table marks the turns with subagent runs, and the Explanation panel lists them", async ({ page, app }) => {
  await openSession(page, app.baseURL);

  // The API's figures: the session total folds the runs in.
  const sessions = (await (await page.request.get(`${app.baseURL}/api/sessions?provider=${PROVIDER}`)).json()) as {
    title: string;
    costAiCredits: { known: boolean; value: number };
    subagentSpend?: { runs: number; costAiCredits: { value: number } };
  }[];
  const listed = sessions.find((session) => session.title === SUBAGENT_SESSION_TITLE)!;
  expect(listed.costAiCredits.value).toBeCloseTo(SUBAGENT_SESSION_CREDITS, 9);
  expect(listed.subagentSpend?.runs).toBe(2);
  await expect(page.getByRole("button", { name: SUBAGENT_SESSION_TITLE })).toContainText("incl. 1.10 AI Credits from 2 subagent runs");

  const markers = page.locator("table tbody .subagent-marker[role=img]");
  await expect(markers).toHaveCount(2);
  await expect(markers.nth(0)).toHaveAttribute("aria-label", "incl. 1.10 AI Credits from 1 subagent run");
  await expect(markers.nth(0)).toHaveAttribute("title", "incl. 1.10 AI Credits from 1 subagent run");
  await expect(markers.nth(1)).toHaveAttribute("aria-label", "incl. 0.00 AI Credits from 1 subagent run");
  await expect(page.locator(".subagent-marker--unknown")).toHaveCount(0);

  // Turn 1: the Explore run, and the turn's total is the main agent's 2.00 plus it.
  await page.locator("table tbody tr").nth(0).click();
  const block = page.getByRole("region", { name: "Subagent runs this turn" });
  await expect(block.getByRole("listitem")).toHaveCount(1);
  await expect(block.getByRole("listitem").first()).toContainText("Explore");
  await expect(block.getByRole("listitem").first()).toContainText("1.10");
  await expect(block.getByRole("group", { name: "Turn totals" })).toContainText("Main agent 2.00");
  await expect(block.getByRole("group", { name: "Turn totals" })).toContainText("Turn 3.10");
  expect(await axeViolations(page, AXE)).toEqual([]);

  // Turn 2: a run that recorded no AI Credits is listed at 0.00, not hidden (D8).
  await page.locator("table tbody tr").nth(1).click();
  await expect(block.getByRole("listitem")).toHaveCount(1);
  await expect(block.getByRole("listitem").first()).toContainText("searchSubagent");
  await expect(block.getByRole("listitem").first()).toContainText("0.00");
  await expect(block.getByRole("group", { name: "Turn totals" })).toContainText("Turn 2.00");
  expect(await axeViolations(page, AXE)).toEqual([]);
});

test("10.19: the Dashboard's model view credits the run's model", async ({ page, app }) => {
  await openDashboard(page, app.baseURL);
  await selectListValue(page, "Provider", /VS Code/i);
  await page.locator("label.seg-opt", { hasText: "All time" }).click();

  // The runs' models stand beside the main agent's in the Model list.
  const models = page.getByRole("listbox", { name: "Model" });
  await expect(models.getByRole("option", { name: /fixture-main-model/ })).toBeVisible();
  await expect(models.getByRole("option", { name: /fixture-search-model/ })).toBeVisible();

  // Choosing the run's model keeps the turn the run is in, with the run's
  // AI Credits in that turn's figure, (the other session's turns are left out of the figure).
  await selectListValue(page, "Model", new RegExp(SUBAGENT_RUN_MODEL));
  const sessions = page.getByRole("listbox", { name: "Session" });
  await expect(sessions.getByRole("option", { name: new RegExp(SUBAGENT_SESSION_TITLE) })).toBeVisible();
  const total = page.getByRole("group", { name: "AI Credits", exact: true });
  await expect(total).toContainText((2 + SUBAGENT_RUNS_CREDITS).toFixed(2));
});
