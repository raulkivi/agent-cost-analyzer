// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Manual check 1.13 (docs/plans/vscode-extension-manual-checks.md) and the
// fixture isolation guard (plan F5), driven in a real VS Code (step 10.16).
import { browser, expect } from "@wdio/globals";
import { INTERNAL_COMMAND_IDS } from "../../../src/diagnostics/test-hooks.js";
import type { SessionsTreeNode } from "../../../src/sidebar/sessions-tree-model.js";
import { AnalyzerPanel, type PanelView } from "../support/analyzer-panel.js";
import { SidebarViews } from "../support/sidebar-views.js";
import { parseUiFixture, UI_FIXTURE_ENV } from "../support/ui-fixture-env.mts";
import { wdioVscodeHost as host } from "../support/vscode-host.js";

const fixture = parseUiFixture(process.env[UI_FIXTURE_ENV]);
const panel = new AnalyzerPanel(host);
const sidebar = new SidebarViews();

const FIRST_SCENARIO = "Cache Basics: An 8-Turn Session";
const SECOND_SCENARIO = "Cache TTL: A 5+ Minute Smoke Break";

function selectedMode(): Promise<string | null> {
  return browser.execute(() => (document.querySelector("input[name='mode']:checked") as HTMLInputElement | null)?.value ?? null);
}

async function expectScenarioOnly(view: PanelView, shown: string, other: string): Promise<void> {
  await view.waitForText(shown);
  expect(await selectedMode()).toBe("learn");
  // No scenario list in the panel: the side bar's Learn view lists them.
  expect(await view.hasText(other)).toBe(false);
  // Full width: the turns start at the panel's left edge, not after the
  // 240 px session list column the standalone app has.
  const tableLeft = await browser.execute(() => document.querySelector("main table")?.getBoundingClientRect().left ?? -1);
  expect(tableLeft).toBeGreaterThanOrEqual(0);
  expect(tableLeft).toBeLessThan(100);
}

suite("Side bar views (check 1.13)", () => {
  suiteSetup(async () => {
    await host.waitForExtension();
    await panel.reset();
  });

  test("the Sessions view lists exactly the fixture's sessions (isolation guard, plan F5)", async () => {
    await host.command(`aiCreditsAnalyzer.sessions.focus`);
    await host.command("aiCreditsAnalyzer.refreshSessions");
    const tree = await host.hook<SessionsTreeNode[]>(INTERNAL_COMMAND_IDS.sessionsTree);
    const sessions = tree.flatMap((node) => (node.kind === "group" ? (node.children ?? []) : [node])).filter((node) => node.kind === "session");
    expect(sessions).toHaveLength(fixture.listedSessionCount);
    const labels = await sidebar.labels("sessions");
    expect(labels).toContain(fixture.usageSessionTitle);
  });

  test("1.13 a Learn scenario opens in Learn mode at full width, another replaces it, and a session switches to Analyze", async () => {
    await sidebar.select("learn", FIRST_SCENARIO);
    await browser.waitUntil(async () => (await (await browser.getWorkbench()).getAllWebviews()).length > 0, { timeout: 30_000 });
    await panel.inside((view) => expectScenarioOnly(view, FIRST_SCENARIO, SECOND_SCENARIO));

    await sidebar.select("learn", SECOND_SCENARIO);
    await panel.inside((view) => expectScenarioOnly(view, SECOND_SCENARIO, FIRST_SCENARIO));

    await sidebar.select("sessions", fixture.usageSessionTitle);
    await panel.inside(async (view) => {
      await browser.waitUntil(async () => (await selectedMode()) === "analyze", { timeout: 30_000, timeoutMsg: "the panel did not switch to Analyze" });
      await view.waitForText(fixture.usageSessionTitle);
    });
  });
});
