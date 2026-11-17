// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Page } from "@playwright/test";
import { axeViolations } from "../support/axe.js";
import { expect, openDashboard, test } from "../support/app-fixture.js";
import { AUDIT_READ_SESSION_TITLE, AUDIT_SHELL_SESSION_TITLE } from "../support/fixture-home.mts";

// Step 10.20 (ST12), the standalone half of plan §7: classic Copilot Chat
// sessions whose subagent runs made tool calls. The fixture home's audit
// sessions (support/fixture-home.mts, `auditSessions`):
//   "Subagent audit session": 2 main calls, a read run (searchSubagent, 3 calls,
//     1 failed) and a run with no log (unread, with its reason)
//   "Subagent audit shell session": a read run of 3 shell calls, one canceled
//     by the user (D14), and a security finding that names the run
// Passes when the Tool audit tab splits and filters by agent, the runs table
// shows the read run's figures and the unread run's reason (never 0), the
// rollup counts the unread session, and the finding names its run.

test.use({ auditSessions: true });

const PROVIDER = "vscode";
const UNREAD_REASON = /this subagent tool writes no log the analyzer reads/;

// The calls table has a status filter; open it to every outcome so the Agent
// filter alone decides the rows.
async function openToolAudit(page: Page, baseURL: string, title: string): Promise<void> {
  await page.goto(baseURL);
  await page.getByText("Analyze", { exact: true }).click();
  const switched = page.waitForResponse((response) => response.url().endsWith("/api/log-providers/active") && response.ok());
  await page.getByRole("combobox", { name: "Log provider" }).selectOption(PROVIDER);
  await switched;
  await page.getByRole("button", { name: title }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.locator("label.seg-opt", { hasText: "Tool audit" }).click();
  await expect(page.getByRole("table", { name: "Tool calls" })).toBeVisible();
}

const rowCount = (page: Page) => page.getByRole("table", { name: "Tool calls" }).locator("tbody tr");

test("10.20: the Tool audit tab splits calls by agent, filters them, and lists the runs", async ({ page, app }) => {
  await openToolAudit(page, app.baseURL, AUDIT_READ_SESSION_TITLE);

  const tools = page.getByRole("group", { name: "Tool calls", exact: true }).first();
  await expect(tools).toContainText("incl. 3 calls from 1 of 2 subagent runs");

  // Every outcome, so the Agent filter alone decides the rows: 2 main + 3 run calls.
  await page.getByRole("button", { name: /^Succeeded/ }).click();
  const agent = page.getByRole("group", { name: "Agent", exact: true });
  await expect(agent.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  await expect(rowCount(page)).toHaveCount(5);
  await agent.getByRole("button", { name: "Main agent" }).click();
  await expect(rowCount(page)).toHaveCount(2);
  await agent.getByRole("button", { name: "Subagents" }).click();
  await expect(rowCount(page)).toHaveCount(3);
  await expect(rowCount(page).first()).toContainText("searchSubagent");
  // The status chips count the same 3 calls, not the main agent's.
  const chipTexts = await page.locator("button.filter-chip", { hasText: /\s\d+$/ }).allTextContents();
  expect(chipTexts.reduce((sum, text) => sum + Number(/(\d+)$/.exec(text.trim())?.[1]), 0)).toBe(3);

  // The API's own origin filter agrees with the chip.
  const calls = (await (await page.request.get(`${app.baseURL}/api/sessions/${await sessionId(page)}/tool-calls?provider=${PROVIDER}&origin=subagent`)).json()) as { total: number };
  expect(calls.total).toBe(3);

  // The runs table: the read run's figures, the unread run's reason and no figure.
  const runs = page.getByRole("table", { name: "Subagent runs" });
  const read = runs.locator("tbody tr", { hasText: "33.3%" });
  await expect(read).toContainText("searchSubagent");
  await expect(read).toContainText("3");
  const unread = runs.locator("tbody tr.audit-run--unread");
  await expect(unread).toHaveCount(1);
  await expect(unread).toContainText(UNREAD_REASON);
  await expect(unread).toContainText("—");

  expect(await axeViolations(page, { exclude: ['ul[aria-label="Sessions"]'] })).toEqual([]);
});

// The fixture's read run is an explore_subagent run linked to its call by the
// call's time window (plan §14.1), so the reader placed it by time (§6).
test("10.20: a run placed by time says so in the runs table, and an unread run does not", async ({ page, app }) => {
  await openToolAudit(page, app.baseURL, AUDIT_READ_SESSION_TITLE);

  const runs = page.getByRole("table", { name: "Subagent runs" });
  await expect(runs.getByText("matched by time")).toHaveCount(1);
  await expect(runs.locator("tbody tr", { hasText: "33.3%" })).toContainText("matched by time");
  await expect(runs.locator("tbody tr.audit-run--unread")).not.toContainText("matched by time");

  // The API says the same, so the pill is not drawn from the label.
  const audit = (await (await page.request.get(`${app.baseURL}/api/sessions/${await sessionId(page)}/audit?provider=${PROVIDER}`)).json()) as {
    subagentRuns: { matchedByTime?: boolean; totals: unknown }[];
  };
  expect(audit.subagentRuns.filter((run) => run.matchedByTime === true)).toHaveLength(1);

  expect(await axeViolations(page, { exclude: ['ul[aria-label="Sessions"]'] })).toEqual([]);
});

test("10.20: a user stop is counted as canceled, not as a failure", async ({ page, app }) => {
  await openToolAudit(page, app.baseURL, AUDIT_SHELL_SESSION_TITLE);

  await expect(page.getByRole("group", { name: "Canceled" })).toContainText("1");
  await expect(page.getByRole("group", { name: "Failure rate" })).toContainText("0%");
  await page.getByRole("button", { name: /^Canceled/ }).click();
  await expect(rowCount(page)).toHaveCount(1);
  await expect(rowCount(page).first()).toContainText("sleep 600");
});

test("10.20: the all-sessions rollup splits main and subagent calls and counts unread runs", async ({ page, app }) => {
  await page.goto(app.baseURL);
  await page.getByText("Analyze", { exact: true }).click();
  const switched = page.waitForResponse((response) => response.url().endsWith("/api/log-providers/active") && response.ok());
  await page.getByRole("combobox", { name: "Log provider" }).selectOption(PROVIDER);
  await switched;
  await page.locator("label.seg-opt", { hasText: "All sessions" }).click();

  await expect(page.getByRole("group", { name: "Tool calls", exact: true })).toContainText("from subagent runs");
  await expect(page.getByRole("group", { name: "Sessions with unread runs" })).toContainText("1 of");
  await expect(page.getByText(/Their subagent calls are unknown, not 0/)).toBeVisible();

  const sessions = page.getByRole("table", { name: "Sessions" });
  await expect(sessions.getByRole("columnheader", { name: "Subagent calls" })).toBeVisible();
  const readRow = sessions.locator("tbody tr", { hasText: AUDIT_READ_SESSION_TITLE });
  await expect(readRow).toContainText("1 run unread");
  const plainRow = sessions.locator("tbody tr", { hasText: "Fix the bug" });
  await expect(plainRow).toContainText("n/a");
  expect(await axeViolations(page, { exclude: ['ul[aria-label="Sessions"]'] })).toEqual([]);
});

test("10.20: a finding from a subagent call names its run", async ({ page, app }) => {
  await openDashboard(page, app.baseURL);
  const signals = page.getByRole("table", { name: "Signals to review" });
  await expect(signals).toBeVisible();
  const finding = signals.locator("tbody tr", { hasText: "Downloaded script piped straight into an interpreter" });
  await expect(finding).toContainText("by subagent run runSubagent-default (turn 0)");
});

async function sessionId(page: Page): Promise<string> {
  const response = await page.request.get(`${new URL(page.url()).origin}/api/sessions?provider=${PROVIDER}`);
  const sessions = (await response.json()) as { id: string; title: string }[];
  return sessions.find((session) => session.title === AUDIT_READ_SESSION_TITLE)!.id;
}
