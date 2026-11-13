// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Scene E10: Learn mode. Open the Learn view, open the compaction scenario, simulate it on
// another vendor's model, then step through the turns to the cache and compaction markers.
// Made-up data (the bundled scenarios), no Copilot.
import { browser, expect } from "@wdio/globals";
import { AnalyzerPanel } from "../support/analyzer-panel.js";
import { SidebarViews, VIEW_CONTAINER_TITLE } from "../support/sidebar-views.js";
import { wdioVscodeHost as host } from "../support/vscode-host.js";
import { runDemoScene, type DemoAction, type DemoScene } from "./support/demo-driver.ts";

const panel = new AnalyzerPanel(host);
const sidebar = new SidebarViews();

const SCENARIO_TITLE = "Context Compaction Mid-Session";
const SCENARIO_TURNS = 5;
// The picker lists the vendors as option groups of one select.
const SIMULATE_ON = "gpt-6.1-sol";

const ACTIVITY_ICON = `//div[contains(@class,'activitybar')]//a[contains(@class,'action-label')][starts-with(@aria-label,'${VIEW_CONTAINER_TITLE}')]`;
const SCENARIO_ROW = `//div[contains(concat(' ',normalize-space(@class),' '),' monaco-list-row ')][contains(.,'${SCENARIO_TITLE}')]`;
const SIMULATE_SELECT = ".vendor-picker select";
const turnRow = (index: number): string => `table tbody tr:nth-child(${index})`;

const stepToTurn = (index: number): DemoAction => (driver) =>
  panel.inside(async () => driver.click(await (await browser.$(turnRow(index))).getElement()));

const scene: DemoScene = {
  id: "E10",
  slug: "learn",
  title: "Learn mode",
  steps: [
    {
      label: "open the AI Credits Analyzer side bar on the Learn view",
      beatMs: 1_000,
      action: async (driver) => {
        await driver.click(await (await browser.$(ACTIVITY_ICON)).getElement());
        await sidebar.showAlone("learn");
        await browser.waitUntil(async () => (await sidebar.rowTexts("learn")).some((row) => /\d+ turns? ·/.test(row)), { timeout: 30_000, timeoutMsg: "the Learn view listed no scenario" });
      },
    },
    {
      label: "open the compaction scenario",
      beatMs: 1_200,
      action: async (driver) => {
        const row = await (await browser.$(SCENARIO_ROW)).getElement();
        await driver.click(row);
        await browser.waitUntil(async () => (await (await browser.getWorkbench()).getAllWebviews()).length > 0, { timeout: 30_000, timeoutMsg: "the panel did not open" });
        await host.command("workbench.action.closeSidebar");
        await panel.settleLayout();
        await panel.inside((view) => view.waitForTurnRows(SCENARIO_TURNS));
      },
    },
    {
      label: "pick another vendor's model to simulate on",
      beatMs: 1_500,
      action: (driver) =>
        panel.inside(async (view) => {
          await driver.pointerTo(await (await browser.$(SIMULATE_SELECT)).getElement());
          await view.chooseSimulationModel(SIMULATE_ON);
        }),
    },
    ...Array.from({ length: SCENARIO_TURNS }, (_, index) => ({
      label: `step to turn ${index + 1}`,
      beatMs: index === 2 ? 1_800 : 900,
      action: stepToTurn(index + 1),
    })),
  ],
};

suite("Demo E10 Learn mode (made-up data)", () => {
  test("E10 plays through Learn mode", async () => {
    await host.waitForExtension();
    await panel.reset();
    await host.command("workbench.action.closeSidebar");
    await host.command("workbench.action.closeAuxiliaryBar");
    const mp4 = await runDemoScene(scene, {
      assertEnd: () =>
        panel.inside(async (view) => {
          expect(await view.turnRowCount()).toBe(SCENARIO_TURNS);
          expect(await view.hasText(SIMULATE_ON)).toBe(true);
          expect(await view.hasText("compaction")).toBe(true);
        }),
    });
    console.log(`E10 master: ${mp4}`);
  });
});
