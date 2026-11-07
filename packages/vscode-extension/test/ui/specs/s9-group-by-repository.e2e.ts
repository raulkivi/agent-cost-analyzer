// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Scenario S9 (Phase 15 step 15.14, docs/plans/cost-by-repository-and-project.md
// §12.4.2, board 7), driven in a real VS Code: the Sessions view grouped by
// repository, the status bar naming the workspace's repository, and the
// panel's Cost over time tab readable in Dark Modern, Light Modern and High
// Contrast. Figures are read off the screen and compared with the fixture's
// expected values (s9-fixture.mts, checked by s9-fixture.test.ts).
import { browser, expect } from "@wdio/globals";
import { judgeProbe, type Probe } from "../../../scripts/ui-check/judge.mts";
import { PROBE_SCRIPT } from "../../../scripts/ui-check/probe.mts";
import { S9_EXPECTED } from "../../../scripts/ui-automation/s9-fixture.mts";
import { COMMAND_IDS } from "../../../src/commands/command-ids.js";
import { AnalyzerPanel } from "../support/analyzer-panel.js";
import { saveScreenshot } from "../support/screenshots.js";
import { SidebarViews } from "../support/sidebar-views.js";
import { isTreeRow } from "../support/tree-row.js";
import { parseS9Fixture, S9_FIXTURE_ENV } from "../support/ui-fixture-env.mts";
import { wdioVscodeHost as host } from "../support/vscode-host.js";

const fixture = parseS9Fixture(process.env[S9_FIXTURE_ENV]);
const panel = new AnalyzerPanel(host);
const sidebar = new SidebarViews();
const THEME_SETTING = "workbench.colorTheme";

// Each status bar item as the service reads it: its accessible name, which
// carries the tooltip's figures as one sentence.
async function statusBarItems(): Promise<string[]> {
  return (await browser.getWorkbench()).getStatusBar().getItems();
}

suite("Scenario S9: VS Code, cost by repository (step 15.14)", () => {
  suiteSetup(async () => {
    await host.waitForExtension({ userDataDir: fixture.userDataDir });
    // Copilot Chat is built in but disabled in a new profile, and without it
    // the required "Copilot Chat unavailable" warning takes the status bar
    // over ("setup needed"), as in the copilot launch (check 1.4).
    await host.command("workbench.extensions.action.enableAll");
    await browser.waitUntil(async () => (await statusBarItems()).some((item) => item.startsWith("AI Credits today")), {
      timeout: 90_000,
      timeoutMsg: "the status bar did not switch from 'setup needed' to today's AI Credits once Copilot Chat was enabled",
    });
    await host.command(COMMAND_IDS.refreshSessions);
  });

  suiteTeardown(async () => {
    await host.setSetting(THEME_SETTING, undefined);
    await host.command(COMMAND_IDS.groupSessionsByDay);
  });

  test("Group by repository: each repository's total equals the fixture's", async () => {
    await host.command(COMMAND_IDS.groupSessionsByRepository);
    await sidebar.showAlone("sessions");
    await browser.waitUntil(async () => (await sidebar.rowTexts("sessions")).some((row) => row.includes(S9_EXPECTED.groups[0].label)), {
      timeout: 30_000,
      timeoutMsg: "the Sessions view did not regroup by repository",
    });
    const rows = await sidebar.rowTexts("sessions");
    for (const group of S9_EXPECTED.groups) {
      expect(rows.some((row) => isTreeRow(row, group.label, group.description))).toBe(true);
    }
    await saveScreenshot("s9-sessions-by-repository");
  });

  test("the status bar shows today's AI Credits for the workspace's repository, and every repository's in its tooltip", async () => {
    let items: string[] = [];
    await browser
      .waitUntil(async () => (items = await statusBarItems()).includes(S9_EXPECTED.statusAriaLabel), { timeout: 30_000 })
      .catch(() => undefined);
    // On a miss, the message says what the status bar did show.
    expect(items.filter((item) => item.includes("AI Credits"))).toContain(S9_EXPECTED.statusAriaLabel);
  });

  for (const [theme, bodyClass] of [
    ["Default Dark Modern", "vscode-dark"],
    ["Default Light Modern", "vscode-light"],
    ["Default High Contrast", "vscode-high-contrast"],
  ] as const) {
    test(`the panel's Cost over time tab in ${theme}: every text reaches WCAG AA`, async () => {
      await host.setSetting(THEME_SETTING, theme);
      await panel.reset();
      await panel.openSession(fixture.usageSessionId);
      const findings = await panel.inside(async (view) => {
        await browser.waitUntil(async () => (await view.bodyClass()).split(" ").includes(bodyClass), { timeout: 30_000, timeoutMsg: `the panel did not switch to ${bodyClass}` });
        await view.waitForTurnRows(1);
        await view.chooseOption("Dashboard");
        await view.waitForText("Insights");
        await view.chooseDashboardView("Cost over time");
        await view.waitForText("Billing and estimates: in the Agent Cost Analyzer app");
        await browser.waitUntil(async () => browser.execute(() => document.querySelector("[role='group'][aria-label='Total cost']") !== null), {
          timeout: 30_000,
          timeoutMsg: "the Cost over time tab did not load",
        });
        const probed = (await browser.execute(`return ${PROBE_SCRIPT}`)) as Probe;
        expect(probed.texts.length).toBeGreaterThan(10);
        return judgeProbe(probed);
      });
      await saveScreenshot(`s9-cost-over-time-${bodyClass}`);
      expect(findings).toEqual([]);
    });
  }
});
