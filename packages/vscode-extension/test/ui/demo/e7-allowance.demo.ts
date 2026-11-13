// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Free demo scene E7 on made-up data: `npm run demo:record`. Set Monthly AI Credits
// Allowance from the Command Palette, type the value into the Settings editor, then the
// status bar gauge (month to date, near limit) and the Sessions row (days left).
import { browser, expect } from "@wdio/globals";
import { gaugeDom, gaugeLabel, GAUGE_ITEM_ID } from "../support/monthly-allowance-gauge.js";
import { SidebarViews } from "../support/sidebar-views.js";
import { wdioVscodeHost as host } from "../support/vscode-host.js";
import { DEMO_FIXTURE_ENV, parseDemoFixture } from "../../../scripts/ui-automation/demo-fixture.mts";
import { runDemoScene, type DemoScene } from "./support/demo-driver.ts";
import { clickAndFocus, inTopContext } from "./support/1.6d-helpers.ts";

const fixture = parseDemoFixture(process.env[DEMO_FIXTURE_ENV], DEMO_FIXTURE_ENV);
const sidebar = new SidebarViews();
const WAIT_MS = 30_000;
const WIDEN_STEPS = 6;
const MONTH_ROW =/^This month: /;
const COMMAND_TITLE = "Set Monthly AI Credits Allowance";
const SETTING_INPUT = ".settings-editor .settings-tree-container .monaco-list-row input";
const ACTIVITY_ICON = ".activitybar [aria-label*='AI Credits Analyzer']";

const scene: DemoScene = {
  id: "E7",
  slug: "allowance",
  title: "Demo E7 Allowance gauge (made-up data)",
  steps: [
    {
      label: "the workbench before an allowance is set",
      beatMs: 1_000,
      action: async () => {
        await host.command("workbench.action.closeSidebar");
        await host.command("workbench.action.closeAllEditors");
        await browser.executeWorkbench((vscode) => vscode.commands.executeCommand("notifications.clearAll"));
      },
    },
    {
      label: "open the Command Palette and type the command",
      beatMs: 1_000,
      action: async (driver) => {
        void host.command("workbench.action.showCommands").catch(() => undefined);
        await browser.waitUntil(async () => (await browser.$(".quick-input-widget")).isDisplayed(), { timeout: WAIT_MS, timeoutMsg: "the Command Palette did not open" });
        await driver.typeSlowly(COMMAND_TITLE, 45);
      },
    },
    {
      label: "run it: the Settings editor opens on the allowance",
      beatMs: 1_200,
      action: async () => {
        await browser.keys(["Enter"]);
        await browser.waitUntil(async () => (await browser.$(SETTING_INPUT)).isExisting(), { timeout: WAIT_MS, interval: 500, timeoutMsg: "the Settings editor did not show the allowance" });
      },
    },
    {
      label: "type the allowance",
      beatMs: 1_500,
      action: async (driver) => {
        await clickAndFocus(driver, SETTING_INPUT);
        await driver.typeSlowly(String(fixture.allowanceForNearLimit), 110);
        await browser.keys(["Tab"]);
        await browser.waitUntil(async () => ((await gaugeDom())?.text ?? "").endsWith("near limit"), { timeout: WAIT_MS, interval: 500, timeoutMsg: "the status bar did not show the near-limit gauge" });
      },
    },
    {
      label: "close the editor, open the Sessions view",
      beatMs: 1_200,
      action: async (driver) => {
        await host.command("workbench.action.closeAllEditors");
        await inTopContext();
        await driver.click(await (await browser.$(ACTIVITY_ICON)).getElement());
        await sidebar.showAlone("sessions");
        // Wide enough that the row's "days left" is not cut off with an ellipsis.
        await host.command("aiCreditsAnalyzer.sessions.focus");
        for (let step = 0; step < WIDEN_STEPS; step++) await host.command("workbench.action.increaseViewSize");
        await browser.waitUntil(async () => MONTH_ROW.test((await sidebar.rowTexts("sessions"))[0] ?? ""), { timeout: WAIT_MS, timeoutMsg: "the Sessions view has no allowance row" });
      },
    },
    {
      label: "hover the status bar gauge",
      beatMs: 2_000,
      action: async (driver) => {
        await inTopContext();
        const item = await (await browser.$(`[id='${GAUGE_ITEM_ID}']`)).getElement();
        await driver.pointerTo(item);
        await item.moveTo();
      },
    },
  ],
};

suite("Demo E7 allowance gauge (made-up data)", () => {
  test("E7 plays through the driver", async () => {
    await host.waitForExtension();
    const mp4 = await runDemoScene(scene, {
      assertEnd: async () => {
        const label = await gaugeLabel();
        expect(label).toMatch(/^Near limit\. AI Credits this month/);
        const [row] = await sidebar.rowTexts("sessions");
        expect(row).toMatch(/^This month: .*near limit.*\d+ days? left/);
        expect((await gaugeDom())?.text).toMatch(/ · near limit$/);
      },
    });
    console.log(`E7 master: ${mp4}`);
  });
});
