// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Free demo scene E6, Trends by repository, on made-up data (`npm run demo:record`):
// Dashboard Overview, Cost over time and Compare, then the Sessions view grouped by
// repository and the status bar naming the workspace's repository.
import { browser, expect } from "@wdio/globals";
import { COMMAND_IDS } from "../../../src/commands/command-ids.js";
import { parseDemoFixture } from "../../../scripts/ui-automation/demo-fixture.mts";
import { AnalyzerPanel } from "../support/analyzer-panel.js";
import { SidebarViews } from "../support/sidebar-views.js";
import { wdioVscodeHost as host } from "../support/vscode-host.js";
import { runDemoScene, type DemoDriver, type DemoScene } from "./support/demo-driver.ts";
import { analyzerStatusItem, closeSidebar } from "./support/1.6e-helpers.ts";
import { saveStill } from "./support/stills.ts";

const fixture = parseDemoFixture(process.env.AICA_DEMO_FIXTURE);
const panel = new AnalyzerPanel(host);
const sidebar = new SidebarViews();
const tab = (label: string): string => `//label[contains(@class,'seg-opt')][normalize-space()='${label}']`;
const GROUP_ACTION = "Group Sessions by Repository";

async function chooseDashboardTab(driver: DemoDriver, label: string): Promise<void> {
  await panel.inside(async (view) => {
    await browser.waitUntil(() => view.hasText(label), { timeout: 30_000, timeoutMsg: `no "${label}" in the Dashboard` });
    await driver.click(await (await browser.$(tab(label))).getElement());
  });
}

const scene: DemoScene = {
  id: "E6",
  slug: "trends",
  title: "Trends by repository",
  steps: [
    {
      label: "open the Dashboard on its Overview",
      beatMs: 1_200,
      action: async (driver) => {
        await closeSidebar();
        // The centre views (Dashboard among them) belong to a session's panel.
        await panel.openSession(fixture.readSession.id);
        await panel.inside(async (view) => {
          await view.waitForTurnRows(1);
          await driver.click(await (await browser.$(tab("Dashboard"))).getElement());
          await view.waitForText("Insights");
          await view.chooseDashboardView("Overview");
        });
      },
    },
    { label: "Cost over time", beatMs: 1_500, action: (driver) => chooseDashboardTab(driver, "Cost over time") },
    {
      label: "Compare",
      beatMs: 800,
      action: async (driver) => {
        await chooseDashboardTab(driver, "Compare");
        // Compare needs two or more projects; the demo's two repositories are the ones to compare.
        await panel.inside(async (view) => {
          await driver.click(await (await browser.$("//label[contains(@class,'seg-opt')][normalize-space()='Repository']")).getElement());
          await browser.waitUntil(async () => !(await view.hasText("Compare needs two or more")), { timeout: 30_000, timeoutMsg: "Compare did not list the repositories" });
        });
      },
    },
    { label: "hold on Compare", beatMs: 1_500, action: async () => undefined },
    {
      label: "open the Sessions view, with Setup below it",
      beatMs: 500,
      action: async () => {
        await host.command("workbench.view.extension.aiCreditsAnalyzer");
        await sidebar.showOnly(["sessions", "setup"]);
        await browser.waitUntil(async () => (await sidebar.rowTexts("sessions")).length > 1, { timeout: 30_000 });
        await browser.waitUntil(async () => ((await sidebar.rowTexts("setup")).join(" ")).includes("No setup problems found"), { timeout: 30_000, timeoutMsg: "Setup does not read: No setup problems found" });
        await saveStill("sidebar");
      },
    },
    {
      label: "Group Sessions by Repository",
      beatMs: 1_500,
      action: async (driver) => {
        await sidebar.showAlone("sessions");
        const header = await browser.$("//div[contains(@class,'pane-header')][contains(translate(normalize-space(.),'SESSIONS','sessions'),'sessions')]");
        await driver.pointerTo(await header.getElement());
        // A view's title actions show while the real mouse is over its header.
        await header.moveTo();
        const action = await browser.$(`a.action-label[aria-label='${GROUP_ACTION}']`);
        await action.waitForExist({ timeout: 10_000, timeoutMsg: `no "${GROUP_ACTION}" action in the Sessions title` });
        await driver.click(await action.getElement());
        await browser.waitUntil(async () => (await sidebar.rowTexts("sessions")).some((row) => row.includes(fixture.repositories.demo.name)), { timeout: 30_000, timeoutMsg: "the Sessions view did not regroup" });
      },
    },
    {
      label: "the status bar names the repository",
      beatMs: 1_800,
      action: async (driver) => driver.pointerTo(await (await analyzerStatusItem()).getElement()),
    },
  ],
};

suite("Demo E6 trends (made-up data)", () => {
  suiteTeardown(async () => {
    await host.command(COMMAND_IDS.groupSessionsByDay);
  });
  test("E6 plays through the driver", async () => {
    await host.waitForExtension({ userDataDir: fixture.userDataDir });
    await panel.reset();
    const mp4 = await runDemoScene(scene, {
      assertEnd: async () => {
        const rows = await sidebar.rowTexts("sessions");
        for (const repo of [fixture.repositories.demo, fixture.repositories.ledger]) expect(rows.some((row) => row.replace(/\s+/g, "").includes(repo.name))).toBe(true);
        const label = (await (await analyzerStatusItem()).getAttribute("aria-label")) ?? "";
        expect(label).toContain(`in ${fixture.repositories.demo.name}`);
      },
    });
    console.log(`E6 master: ${mp4}`);
  });
});
