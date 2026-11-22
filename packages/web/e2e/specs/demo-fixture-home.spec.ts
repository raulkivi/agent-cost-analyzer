// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SavingsReport } from "@agent-cost-analyzer/domain";
import { unlistedTools } from "@agent-cost-analyzer/domain";
import { expect, test } from "../support/app-fixture.js";
import { DEMO_PI_SESSION, DEMO_UNUSED_TOOLS_SERVER, DEMO_UNUSED_TOOLS_SESSIONS, DEMO_UNUSED_TOOLS_TOOLS } from "../support/demo-fixture-home.mts";
import { FIXTURE_NOW } from "../support/fixture-clock.js";

// DR1 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/demo-recordings-1.0.md §4): the demo variant of the fixture home, read through the
// real server's Savings API as W3, F4 and M8 will see it. The shared home (every other spec) has none
// of these rows; sv1-savings-report.spec.ts pins that.
test.use({ demo: true });

const DAY_MS = 86_400_000;
const SINCE = new Date(Date.parse(FIXTURE_NOW) - 30 * DAY_MS).toISOString().slice(0, 10);

async function report(page: import("@playwright/test").Page, baseURL: string): Promise<SavingsReport> {
  const response = await page.request.get(`${baseURL}/api/savings?since=${SINCE}&pricing=as-of-use&includeSimulated=false`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as SavingsReport;
}

test("DR1: an unused-tools row of six MCP tools shows 'and 1 more (about X)', with its sessions and titles", async ({ page, app }) => {
  const savings = await report(page, app.baseURL);
  const row = savings.opportunities.find((opportunity) => opportunity.kind === "unused-tools" && opportunity.subject === DEMO_UNUSED_TOOLS_SERVER);
  expect(row, "the demo row").toBeDefined();
  expect(row!.toolsTotal).toBe(DEMO_UNUSED_TOOLS_TOOLS.length);
  expect(row!.evidence.sessions).toBe(DEMO_UNUSED_TOOLS_SESSIONS.length);
  expect(row!.tools!.every((tool) => tool.sessions === row!.evidence.sessions), "R23: every tool loaded in every session of the row").toBe(true);
  const rest = unlistedTools(row!.tools!.slice(0, 5), row!.toolsTotal!, row!.evidence.tokens, row!.evidence.sessions);
  expect(rest.count).toBe(1);
  expect(rest.tokens).not.toBeNull();
  expect(row!.perWeek.known).toBe(true);
  expect(row!.sessions.map((ref) => ref.startedAt?.slice(0, 10)).sort()).toEqual(DEMO_UNUSED_TOOLS_SESSIONS.map((session) => session.startedAt.slice(0, 10)).sort());
});

test("DR1: the pi session on a local model is a 'Not priced' row, and nothing reads fixture-", async ({ page, app }) => {
  const savings = await report(page, app.baseURL);
  const piRows = savings.opportunities.filter((opportunity) => opportunity.kind === "unused-tools" && opportunity.subject !== DEMO_UNUSED_TOOLS_SERVER);
  expect(piRows.length, "pi's declared tools that no turn ran").toBeGreaterThan(0);
  for (const row of piRows) {
    expect(row.perWindow.known, "no price for a local model").toBe(false);
    expect(row.evidence.tokens?.known).toBe(true);
  }
  expect(JSON.stringify(savings)).not.toContain("fixture-");

  // The Copilot sessions of the unused-tools row carry billed AI Credits, so Open cost has a figure.
  const copilot = (await (await page.request.get(`${app.baseURL}/api/sessions`)).json()) as { id: string; costAiCredits: { known: boolean } }[];
  for (const session of DEMO_UNUSED_TOOLS_SESSIONS) expect(copilot.find((entry) => entry.id === session.id)?.costAiCredits.known).toBe(true);

  // The session list is the active provider's: switch to pi, whose session carries its file's name.
  expect((await page.request.put(`${app.baseURL}/api/log-providers/active`, { data: { id: "pi-agent" } })).ok()).toBe(true);
  const pi = await (await page.request.get(`${app.baseURL}/api/sessions`)).text();
  expect(pi).toContain(DEMO_PI_SESSION.title);
  expect(pi).not.toContain("fixture-");
});
