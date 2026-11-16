// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Page } from "@playwright/test";
import { axeViolations } from "../support/axe.js";
import { expect, test } from "../support/app-fixture.js";
import { CLAUDE_SUBAGENT_KNOWN_TITLE, CLAUDE_SUBAGENT_UNKNOWN_TITLE } from "../support/fixture-home.mts";

// Step CS13 (docs/plans/claude-code-subagents.md §5.6, CS2 boards): Claude
// Code sessions whose `Agent` calls started subagent runs. The fixture home's
// sessions (support/fixture-home.mts, `claudeSubagentSessions`):
//   "known-run"    one run, linked by its Agent call: tokens and a priced cost
//   "missing-run"  an Agent call whose transcript is missing: an unknown run
// Passes when the turns table marks the turn with tokens and priced cost in
// the words (never an AI Credits figure), the Explanation panel lists the run
// and the totals, an unknown run reads as dashes with its reason (never 0),
// and the narrow layout's KPI tiles carry the Priced cost and AI Credits n/a.

test.use({ claudeSubagentSessions: true });

const PROVIDER = "claude-code";
const MISSING = "the subagent transcript this turn started is missing";

// The axe checks cover the turns table, the Explanation panel and the tiles,
// not the session list beside them (its cards are named by the title alone
// and the advice checkbox is under 24 px; both predate this scenario).
const AXE = { exclude: ['ul[aria-label="Sessions"]'] };

async function openSession(page: Page, baseURL: string, title: string): Promise<void> {
  await page.goto(baseURL);
  await page.getByText("Analyze", { exact: true }).click();
  const switched = page.waitForResponse((response) => response.url().endsWith("/api/log-providers/active") && response.ok());
  await page.getByRole("combobox", { name: "Log provider" }).selectOption(PROVIDER);
  await switched;
  await page.getByRole("button", { name: new RegExp(`^${title}`) }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test("CS13: the turns table marks the turn with tokens and priced cost, the Explanation panel lists the run, and AI Credits stay a dash", async ({ page, app }) => {
  await openSession(page, app.baseURL, CLAUDE_SUBAGENT_KNOWN_TITLE);

  const marker = page.locator("table tbody .subagent-marker[role=img]");
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveAttribute("aria-label", "incl. 1.7k tokens, $0.0042 priced, from 1 subagent run");
  await expect(marker).toHaveAttribute("title", "incl. 1.7k tokens, $0.0042 priced, from 1 subagent run");
  // The marker is in the Turn cell; the AI Credits cell is an em dash with its reason, never 0.
  await expect(page.locator("table tbody tr").first().locator("td").first()).toHaveText("0");
  await expect(page.locator("table tbody tr").first().locator("td").first().locator(".subagent-marker")).toHaveCount(1);
  await expect(page.locator("table tbody tr").first().locator("[title*='no AI Credits conversion']")).toHaveText("—");

  await page.locator("table tbody tr").first().click();
  const block = page.getByRole("region", { name: "Subagent runs this turn" });
  await expect(block.getByRole("listitem")).toHaveCount(1);
  const run = block.getByRole("listitem").first();
  await expect(run).toContainText("general-purpose");
  await expect(run).toContainText("claude-sonnet-5-5");
  await expect(run).toContainText("2 requests");
  await expect(run).toContainText("1.7k tokens");
  await expect(run).toContainText("$0.0042");
  const totals = block.getByRole("group", { name: "Turn totals" });
  await expect(totals).toContainText("Main agent 5.2k · $0.0071");
  await expect(totals).toContainText("Subagent runs 1.7k · $0.0042");
  await expect(totals).toContainText("Turn 6.9k · $0.0113");
  await expect(block).toContainText("Priced at Anthropic prices as of 2026-10-01, each run on its own model. Claude Code has no AI Credits.");
  expect(await block.textContent()).not.toMatch(/\d AI Credits/);
  expect(await axeViolations(page, AXE)).toEqual([]);

  // The API's figures are the ones shown.
  const sessions = (await (await page.request.get(`${app.baseURL}/api/sessions`)).json()) as { id: string; title: string }[];
  const id = sessions.find((session) => session.title === CLAUDE_SUBAGENT_KNOWN_TITLE)!.id;
  const detail = (await (await page.request.get(`${app.baseURL}/api/sessions/${id}`)).json()) as {
    turns: { usage: { pricedCost: { amount: number }; subagents: { pricedCost: { amount: number } }[] } }[];
    subagentSpend: { runs: number; cost: { priced: { amount: number } } };
  };
  expect(detail.turns[0]!.usage.pricedCost.amount).toBeCloseTo(0.0113, 9);
  expect(detail.turns[0]!.usage.subagents[0]!.pricedCost.amount).toBeCloseTo(0.00424, 9);
  expect(detail.subagentSpend).toMatchObject({ runs: 1 });
  expect(detail.subagentSpend.cost.priced.amount).toBeCloseTo(0.00424, 9);
});

test("CS13: a run whose transcript is missing reads as dashes with its reason, never 0", async ({ page, app }) => {
  await openSession(page, app.baseURL, CLAUDE_SUBAGENT_UNKNOWN_TITLE);

  const marker = page.locator("table tbody .subagent-marker--unknown[role=img]");
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveAttribute("aria-label", `Tokens and cost unknown: ${MISSING}.`);

  await page.locator("table tbody tr").first().click();
  const block = page.getByRole("region", { name: "Subagent runs this turn" });
  const run = block.getByRole("listitem").first();
  await expect(run).toHaveClass(/subagent-run--unknown/);
  await expect(run).toContainText("model unknown");
  await expect(run).toContainText("The subagent transcript this turn started is missing.");
  const totals = block.getByRole("group", { name: "Turn totals" });
  await expect(totals).toContainText("Main agent 5.2k · $0.0071");
  await expect(totals).toContainText("Subagent runs unknown");
  await expect(totals).toContainText("Turn unknown");
  await expect(block).toContainText("This turn's tokens and cost are unknown until the general-purpose run can be read.");
  expect(await axeViolations(page, AXE)).toEqual([]);
});

test("CS13: the narrow layout's KPI tiles read AI Credits n/a and a Priced cost with the runs' sub-line", async ({ page, app }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await openSession(page, app.baseURL, CLAUDE_SUBAGENT_KNOWN_TITLE);

  await expect(page.getByRole("group", { name: "AI Credits", exact: true })).toContainText("n/a");
  const tile = page.getByRole("group", { name: "Priced cost", exact: true });
  await expect(tile).toContainText("$0.0113");
  await expect(tile).toContainText("incl. $0.0042 and 1.7k tokens from 1 subagent run");
  expect(await axeViolations(page, AXE)).toEqual([]);

  // The unknown session says unknown with the reason, not a smaller total.
  await page.getByRole("button", { name: new RegExp(`^${CLAUDE_SUBAGENT_UNKNOWN_TITLE}`) }).click();
  await expect(page.getByRole("heading", { name: CLAUDE_SUBAGENT_UNKNOWN_TITLE })).toBeVisible();
  const unknown = page.getByRole("group", { name: "Priced cost", exact: true });
  await expect(unknown).toContainText("unknown");
  await expect(unknown).toContainText("unknown: The subagent transcript this turn started is missing.");
});
