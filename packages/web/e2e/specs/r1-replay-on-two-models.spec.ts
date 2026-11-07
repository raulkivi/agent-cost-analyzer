// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Page } from "@playwright/test";
import type { SessionReplay, SessionReplayComparison } from "@agent-cost-analyzer/domain";
import { axeViolations } from "../support/axe.js";
import { expect, test } from "../support/app-fixture.js";

// Scenario R1, "Replay a session on two models" (docs/plans/
// analyze-session-replay.md §10 and §12 row 14.7, boards 1 to 3): open a
// Claude Code session in Analyze, Replay on model A, then model B, open the
// summary and close it with Escape, then Compare models. Passes when every
// figure the page shows is the API's (one answer, as S10), the summary
// shows its assumptions the first time and gives focus back, and the
// Compare models table lists both models with the measured model tagged.
//
// The fixture home's (support/fixture-home.mts) two-turn portal-web session
// of 2026-10-05, on Claude Sonnet 5.5: inside the price book's window (from
// 2026-10-01), so the measured total and both replays are priced at the
// API's prices of that day. A is gpt-6.1-sol (OpenAI), B claude-opus-5.5.

const PROVIDER = "claude-code";
const MODEL_A = "gpt-6.1-sol";
const MODEL_B = "claude-opus-5.5";
const OWN_MODEL = "claude-sonnet-5.5";

// The axe checks cover the replay, not the session list beside it: its
// cards are named by the title alone (label-content-name-mismatch) and the
// advice checkbox is under 24 px (target-size), both before Phase 14 and
// outside this scenario.
const AXE = { exclude: ['ul[aria-label="Sessions"]'] };

// The app's USD under $1 (lib/ai-credits-usd.ts formatUsd): up to 4
// decimals, trailing zeros dropped, at least 2.
function usd(value: number): string {
  const [whole, decimals = ""] = value.toFixed(4).split(".");
  return `$${whole}.${decimals.replace(/0+$/, "").padEnd(2, "0")}`;
}

async function replayFromApi(page: Page, baseURL: string, sessionId: string, model: string): Promise<SessionReplay> {
  const response = await page.request.get(`${baseURL}/api/sessions/${sessionId}/replay?model=${model}&provider=${PROVIDER}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as SessionReplay;
}

async function expectStripToMatch(page: Page, replay: SessionReplay): Promise<void> {
  expect(replay.totals.simulated.value).not.toBeNull();
  expect(replay.totals.measured.value).not.toBeNull();
  const strip = page.getByRole("region", { name: "Replay summary" });
  await expect(strip.getByRole("group", { name: "Simulated total" })).toContainText(usd(replay.totals.simulated.value!));
  await expect(strip.getByRole("group", { name: "Measured total" })).toContainText(usd(replay.totals.measured.value!));
  await expect(strip).toContainText(`This session would have cost about ${usd(replay.totals.simulated.value!)} on ${replay.model}.`);
  await expect(strip).toContainText(`${replay.coverage.replayedTurns} of ${replay.coverage.turns} turns replayed`);
  expect(replay.selfCheck?.passed).toBe(true);
  await expect(strip).toContainText(`Replay matches the log on ${replay.selfCheck!.model}: 100% of compared requests`);
  await expect(page.getByRole("columnheader", { name: `Simulated ${replay.model}` })).toBeVisible();
}

test("R1: replay a Claude Code session on two models, its summary and Compare models", async ({ page, app }) => {
  await page.goto(app.baseURL);
  await page.getByText("Analyze", { exact: true }).click();
  const switched = page.waitForResponse((response) => response.url().endsWith("/api/log-providers/active") && response.ok());
  await page.getByRole("combobox", { name: "Log provider" }).selectOption(PROVIDER);
  await switched;

  const sessions = (await (await page.request.get(`${app.baseURL}/api/sessions`)).json()) as { id: string; title: string; turnCount: number; startedAt?: string }[];
  const session = sessions.find((candidate) => candidate.startedAt === "2026-10-05T09:00:00.000Z");
  expect(session, "the fixture home's 2026-10-05 portal-web session").toBeDefined();
  expect(session!.turnCount).toBe(2);

  const [replayA, replayB] = [await replayFromApi(page, app.baseURL, session!.id, MODEL_A), await replayFromApi(page, app.baseURL, session!.id, MODEL_B)];
  expect(replayA.totals.simulated.value).not.toEqual(replayB.totals.simulated.value);

  // The session list names a Claude Code session by its folder; two are
  // portal-web, so pick this one by its two turns.
  await page.getByRole("button", { name: new RegExp(`^${session!.title}`) }).filter({ hasText: /2 turns/ }).click();
  await expect(page.getByRole("heading", { name: session!.title })).toBeVisible();

  // Model A: the Simulated columns and the strip, with coverage and the self-check.
  const picker = page.getByRole("combobox", { name: "Replay on" });
  await picker.selectOption(MODEL_A);
  await expectStripToMatch(page, replayA);

  // Model B: the figures change, to the API's for B.
  await picker.selectOption(MODEL_B);
  await expect(page.getByRole("columnheader", { name: `Simulated ${MODEL_A}` })).toHaveCount(0);
  await expectStripToMatch(page, replayB);
  expect(await axeViolations(page, AXE)).toEqual([]);

  // The summary: assumptions shown the first time; Escape gives focus back.
  const summaryButton = page.getByRole("button", { name: "Replay summary" });
  await summaryButton.click();
  const dialog = page.getByRole("dialog", { name: `${session!.title} on ${MODEL_B}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("list", { name: "Assumptions" })).toBeVisible();
  expect(await axeViolations(page, AXE)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(summaryButton).toBeFocused();

  // Compare models: both models listed, the measured model tagged, every
  // total the compare route's.
  const compared = page.waitForResponse((response) => response.url().includes(`/api/sessions/${session!.id}/replay/compare`));
  await page.getByRole("button", { name: "Compare models" }).click();
  const shown = (await (await compared).json()) as SessionReplayComparison;
  const direct = (await (
    await page.request.get(`${app.baseURL}/api/sessions/${session!.id}/replay/compare?models=${MODEL_A},${MODEL_B}&provider=${PROVIDER}`)
  ).json()) as SessionReplayComparison;
  const totalOf = (comparison: SessionReplayComparison, model: string) => comparison.entries.find((entry) => entry.model === model)?.total.value;
  for (const model of [MODEL_A, MODEL_B, OWN_MODEL]) {
    expect(totalOf(direct, model), model).not.toBeUndefined();
    expect(totalOf(direct, model), model).not.toBeNull();
    expect(totalOf(shown, model), model).toEqual(totalOf(direct, model));
  }
  expect(totalOf(direct, MODEL_A)).toEqual(replayA.totals.simulated.value);
  expect(totalOf(direct, MODEL_B)).toEqual(replayB.totals.simulated.value);

  const table = page.getByRole("table", { name: /Simulated cost of this session on each model/ });
  await expect(table).toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(shown.entries.length);
  for (const entry of shown.entries) {
    const row = table.locator("tbody tr").filter({ has: page.locator(".mono", { hasText: new RegExp(`^${entry.model.replace(/\./g, "\\.")}$`) }) });
    await expect(row).toHaveCount(1);
    await expect(row.locator("td").nth(3)).toHaveText(entry.total.value === null ? "unknown" : usd(entry.total.value));
    if (entry.isMeasuredModel) await expect(row).toContainText("Measured model");
    else await expect(row).not.toContainText("Measured model");
  }
  expect(shown.entries.find((entry) => entry.isMeasuredModel)?.model).toBe(OWN_MODEL);
  expect(await axeViolations(page, AXE)).toEqual([]);
});
