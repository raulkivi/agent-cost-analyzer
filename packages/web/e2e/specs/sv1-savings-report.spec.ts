// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Locator, Page } from "@playwright/test";
import type { SavingsOpportunity, SavingsReport } from "@agent-cost-analyzer/domain";
import { axeViolations } from "../support/axe.js";
import { chooseOption, expect, openDashboard, test } from "../support/app-fixture.js";
import { FIXTURE_NOW } from "../support/fixture-clock.js";
import { expectedListName, expectedRow, expectedSessionDate, expectedSessionSaving } from "../support/savings-text.js";

// Dates read in the viewer's time zone; the spec pins it so they are the API's UTC day.
test.use({ timezoneId: "UTC" });

// Scenario SV1, "Find what to change" (docs/plans/savings-report.md §10 SR15,
// boards Dashboard, Detail, Narrow): open Dashboard > Savings, read the
// ranked lists, open a row, Copy its text, use the keyboard, at 320 px.
// Passes when every figure on the page is the API's (GET /api/savings, asked
// for the tab's own default window), the labels are the words the plan
// requires, nothing adds the lists up, and axe finds nothing (no exclusions:
// the Dashboard's other tabs pass axe in S1 to S10 unexcluded).
//
// The fixture home's Claude Code session c0000000-...-000000000020 of
// 2026-10-30 has an idle gap past the 1-hour cache and a model switch; the
// price book prices both in USD as upper bounds (SR13). Every other session
// of the window is listed under Not analysed.

const DAY_MS = 24 * 60 * 60 * 1000;
// The tab's default window: the last 30 days to the page's clock.
const SINCE = new Date(Date.parse(FIXTURE_NOW) - 30 * DAY_MS).toISOString().slice(0, 10);

async function reportFromApi(page: Page, baseURL: string): Promise<SavingsReport> {
  const response = await page.request.get(`${baseURL}/api/savings?since=${SINCE}&pricing=as-of-use&includeSimulated=false`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as SavingsReport;
}

async function openSavings(page: Page, baseURL: string): Promise<Locator> {
  await openDashboard(page, baseURL);
  await chooseOption(page, "Dashboard view", "Savings");
  const tab = page.getByTestId("savings-tab");
  await expect(tab.getByRole("list", { name: "US dollars" })).toBeVisible();
  return tab;
}

function rowOf(tab: Locator, opportunity: SavingsOpportunity): Locator {
  return tab.getByRole("list", { name: expectedListName(opportunity)! }).getByTestId("savings-row").filter({ hasText: expectedRow(opportunity).title });
}

test("SV1: the Savings tab shows the API's figures, labelled, never added up", async ({ page, app }) => {
  const report = await reportFromApi(page, app.baseURL);
  const kinds = report.opportunities.map((opportunity) => opportunity.kind).sort();
  expect(kinds, "the fixture's Claude Code session: an idle gap and a model switch").toEqual(["idle-cache-expiry", "model-switch"]);
  expect(report.opportunities.every((opportunity) => opportunity.perWeek.known && opportunity.perWeek.currency === "USD")).toBe(true);

  const tab = await openSavings(page, app.baseURL);

  // Every row, in the API's order, with the API's figures; one list per currency.
  await expect(tab.getByRole("list", { name: "AI Credits" })).toHaveCount(0);
  const rows = tab.getByRole("list", { name: "US dollars" }).getByTestId("savings-row");
  await expect(rows).toHaveCount(report.opportunities.length);
  for (const [index, opportunity] of report.opportunities.entries()) {
    const expected = expectedRow(opportunity);
    const row = rows.nth(index);
    await expect(row.locator(".savings-rank")).toHaveText(String(index + 1));
    await expect(row.locator(".savings-row-title")).toHaveText(expected.title);
    await expect(row.locator(".savings-subject-text")).toHaveText(expected.subject);
    await expect(row.locator(".savings-amount-text")).toHaveText(expected.amount);
    await expect(row.locator(".savings-coverage")).toHaveText(expected.coverage);
    await expect(row.locator(".savings-bar")).toHaveCount(1);
  }

  // Labels: an upper bound says "up to"; the bar's meaning is in words; no total.
  await expect(tab.getByText(/^up to \$\d/).first()).toBeVisible();
  await expect(tab.getByText("Bars compare rows in this list only.")).toBeVisible();
  await expect(tab.getByText(/Opportunities overlap, so they are not added up/)).toBeVisible();
  await expect(tab).not.toContainText(/\bTotal\b/);
  await expect(tab.getByRole("combobox", { name: "Window" })).toHaveValue("30");
  await expect(tab.getByRole("combobox", { name: "Provider" })).toBeVisible();
  await expect(tab.getByRole("combobox", { name: "Prices" })).toBeVisible();
  await expect(tab.getByRole("checkbox", { name: "Include simulated" })).not.toBeChecked();
  await expect(tab.getByRole("button", { name: "Refresh" })).toBeVisible();
  await expect(tab.getByRole("region", { name: "Simulated" })).toHaveCount(0);

  // Not analysed: each entry of the API, with its session count and reason.
  expect(report.notAnalysed.length).toBeGreaterThan(0);
  const notAnalysed = tab.getByRole("list", { name: "Not analysed" }).getByRole("listitem");
  await expect(notAnalysed).toHaveCount(report.notAnalysed.length);
  for (const [index, entry] of report.notAnalysed.entries()) {
    await expect(notAnalysed.nth(index)).toContainText(entry.reason);
    await expect(notAnalysed.nth(index)).toContainText(`${entry.sessions} ${entry.sessions === 1 ? "session" : "sessions"}`);
  }

  expect(await axeViolations(page)).toEqual([]);
});

test("SV1: a row opens its detail with the API's figures; Copy puts the action text on the clipboard", async ({ page, app, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: app.baseURL });
  const report = await reportFromApi(page, app.baseURL);
  const opportunity = report.opportunities.find((candidate) => candidate.kind === "idle-cache-expiry")!;
  // The log's own session id is the API's (a Claude Code id is mapped to a short one).
  const sessionId = opportunity.sessions[0]!.sessionId;
  const tab = await openSavings(page, app.baseURL);

  await rowOf(tab, opportunity).getByRole("button").click();
  const detail = tab.getByRole("region", { name: "Savings detail" });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("heading", { name: expectedRow(opportunity).title })).toBeVisible();
  await expect(detail).toContainText(expectedRow(opportunity).amount);
  await expect(detail).toContainText("Priced from the price book: what the same tokens would cost another way. It cannot be billed.");
  await expect(detail).toContainText("An upper bound: the most it could be. No lower end is claimed.");
  await expect(detail.getByRole("region", { name: "Evidence" })).toContainText(`${opportunity.evidence.sessions}`);
  await expect(detail.getByRole("link", { name: `Open in Analyze: ${sessionId}` }).or(detail.getByRole("button", { name: `Open in Analyze: ${sessionId}` }))).toBeVisible();
  // V24: each shown session's date and saving are the API's (the browser runs in UTC).
  const sessions = detail.getByRole("region", { name: "Sessions" });
  await expect(sessions).toContainText(`saving over the ${report.window.days} days`);
  for (const [index, session] of opportunity.sessions.slice(0, 5).entries()) {
    const item = sessions.getByRole("listitem").nth(index);
    await expect(item).toContainText(session.sessionId);
    await expect(item).toContainText(expectedSessionDate(session.startedAt));
    await expect(item).toContainText(expectedSessionSaving(session.perWindow));
  }
  await expect(detail.getByText("Suggestion only. This app does not change settings or files.")).toBeVisible();
  const versions = detail.locator("details", { hasText: /^Price versions \(\d+\)/ });
  await expect(versions).toBeVisible();
  expect(await versions.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(false);
  expect(await axeViolations(page)).toEqual([]);

  const action = (await detail.locator(".savings-action").textContent())!.replace(/\s+/g, " ").trim();
  expect(action.length).toBeGreaterThan(10);
  await detail.getByRole("button", { name: "Copy text" }).click();
  await expect(detail.getByRole("status")).toHaveText("Copied");
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\s+/g, " ").trim()).toBe(action);

  // The model switch's detail: its own evidence from the API.
  const sw = report.opportunities.find((candidate) => candidate.kind === "model-switch")!;
  await rowOf(tab, sw).getByRole("button").click();
  await expect(detail.getByRole("heading", { name: expectedRow(sw).title })).toBeVisible();
  await expect(detail).toContainText(expectedRow(sw).amount);
  expect(sw.evidence.tokens?.known).toBe(true);
  if (sw.evidence.tokens?.known) await expect(detail).toContainText(sw.evidence.tokens.value.toLocaleString("en-US"));
  await detail.getByRole("button", { name: "Close detail" }).click();
  await expect(detail).toHaveCount(0);
});

// V25 (D24): titles are looked up in the browser from the insights dataset and
// shown first; the savings answer itself holds none.
test("SV1: each session shows its dataset title first, the id under it; the savings answer holds no title", async ({ page, app }) => {
  const savingsResponse = await page.request.get(`${app.baseURL}/api/savings?since=${SINCE}&pricing=as-of-use&includeSimulated=false`);
  const savingsText = await savingsResponse.text();
  const report = JSON.parse(savingsText) as SavingsReport;
  const insights = await page.request.get(`${app.baseURL}/api/insights?since=${SINCE}&limit=200`);
  const rows = ((await insights.json()) as { sessions: { key: string; title: string }[] }).sessions;
  const titleOfKey = new Map(rows.map((row) => [row.key, row.title.replace(/\s+/g, " ").trim()]));
  const opportunity = report.opportunities.find((candidate) => candidate.kind === "idle-cache-expiry")!;
  const shown = opportunity.sessions.slice(0, 5);
  const titles = shown.map((session) => titleOfKey.get(`${session.providerId}:${session.sessionId}`) ?? "");
  expect(titles.some((title) => title !== ""), "the fixture's session has a title in the dataset").toBe(true);
  for (const title of titles.filter((candidate) => candidate !== "")) expect(savingsText).not.toContain(title);

  const tab = await openSavings(page, app.baseURL);
  await rowOf(tab, opportunity).getByRole("button").click();
  const sessions = tab.getByRole("region", { name: "Savings detail" }).getByRole("region", { name: "Sessions" });
  for (const [index, session] of shown.entries()) {
    const item = sessions.getByRole("listitem").nth(index);
    const title = titles[index]!;
    if (title === "") {
      await expect(item).toContainText(session.sessionId);
      await expect(item.getByRole("button", { name: `Open in Analyze: ${session.sessionId}` })).toBeVisible();
      continue;
    }
    const shownTitle = [...title].slice(0, 120).join("");
    await expect(item.locator(".savings-session-title")).toHaveText(shownTitle);
    await expect(item.locator(".savings-session-title")).toHaveAttribute("title", shownTitle);
    await expect(item.locator(".savings-session-meta")).toContainText(session.sessionId);
    await expect(item.getByRole("button", { name: `Open in Analyze: ${session.sessionId}: ${shownTitle}` })).toBeVisible();
  }
  expect(await axeViolations(page)).toEqual([]);
});

// V26 (board Detail): the fixture home holds no unused MCP server, so the
// API's answer is replaced by its own first row turned into an unused-tools row.
test("SV1: an unused-tools row lists its tools, five shown, with 'and N more' and the estimate label", async ({ page, app }) => {
  const report = await reportFromApi(page, app.baseURL);
  const base = report.opportunities[0]!;
  const estimate = (value: number) => ({ known: true as const, value, estimated: true as const });
  const names = ["create_pull_request", "search_code", "list_issues", "get_file_contents", "list_commits", "get_me", "fork_repository"];
  const unused: SavingsOpportunity = {
    ...base,
    key: "unused-tools:github:USD",
    kind: "unused-tools",
    subject: "github",
    inferred: true,
    evidence: { sessions: 31, requests: 877, tokens: estimate(5400), occurrences: null },
    actionParams: { group: "github", tools: 23, tokens: 5400, sessions: 31, days: 30 },
    tools: names.map((name, index) => ({ name: `mcp_github_${name}`, tokens: estimate(610 - index * 40), sessions: 31 - index })),
    toolsTotal: 23,
  };
  // Four of the five listed tools were loaded in fewer than the row's 31 sessions (R23, D35): no tokens for the rest.
  await page.route(/\/api\/savings\?/, (route) => route.fulfill({ json: { ...report, opportunities: [unused] } }));
  const tab = await openSavings(page, app.baseURL);

  await rowOf(tab, unused).getByRole("button").click();
  const tools = tab.getByRole("region", { name: "Savings detail" }).getByRole("region", { name: "Tools" });
  await expect(tools.getByRole("heading", { name: "The 23 tools, never called in 31 sessions" })).toBeVisible();
  await expect(tools.getByRole("row")).toHaveCount(1 + 5 + 1);
  await expect(tools.getByRole("row").nth(1)).toContainText("mcp_github_create_pull_request");
  await expect(tools.getByRole("row").nth(1)).toContainText("loaded in 31 sessions");
  await expect(tools.getByRole("row").nth(1)).toContainText("about 610");
  await expect(tools.getByRole("row").nth(6)).toContainText("and 18 more");
  await expect(tools.getByRole("row").nth(6)).not.toContainText("about");
  await expect(tools.getByText("estimate")).toBeVisible();
  await expect(tools).not.toContainText("mcp_github_get_me");
  expect(await axeViolations(page)).toEqual([]);
});

test("SV1: the keyboard opens a row, Escape closes it and gives focus back", async ({ page, app }) => {
  const report = await reportFromApi(page, app.baseURL);
  const tab = await openSavings(page, app.baseURL);
  const first = tab.getByTestId("savings-row").first().getByRole("button");
  await first.focus();
  await page.keyboard.press("Enter");
  const detail = tab.getByRole("region", { name: "Savings detail" });
  await expect(detail).toBeVisible();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(detail.getByRole("heading", { name: expectedRow(report.opportunities[0]!).title })).toBeVisible();

  // From inside the detail, too.
  await detail.getByRole("button", { name: "Copy text" }).focus();
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute("aria-pressed", "false");
});

test("SV1: at 320 px the detail replaces the list and the page does not scroll sideways", async ({ page, app }) => {
  const report = await reportFromApi(page, app.baseURL);
  const tab = await openSavings(page, app.baseURL);
  await page.setViewportSize({ width: 320, height: 800 });
  const first = tab.getByTestId("savings-row").first();
  await expect(first).toBeVisible();
  const noSidewaysScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  await expect.poll(noSidewaysScroll).toBe(true);

  await first.getByRole("button").click();
  const detail = tab.getByRole("region", { name: "Savings detail" });
  await expect(detail).toBeVisible();
  await expect(detail).toContainText(expectedRow(report.opportunities[0]!).amount);
  await expect(tab.getByRole("list", { name: "US dollars" })).toHaveCount(0);
  await expect.poll(noSidewaysScroll).toBe(true);
  expect(await axeViolations(page)).toEqual([]);

  await detail.getByRole("button", { name: "Back to the list" }).click();
  await expect(tab.getByRole("list", { name: "US dollars" })).toBeVisible();
  await expect(first.getByRole("button")).toBeFocused();
  expect(await axeViolations(page)).toEqual([]);
});
