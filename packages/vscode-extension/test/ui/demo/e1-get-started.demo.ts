// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Scene E1: get started. The Setup view flags three optional Copilot settings (debug logging,
// "keep at least 200 sessions", agent traces); each row's **Fix Setting** opens exactly that
// setting in the Settings editor, the user changes it there, and Setup turns green.
// Runs in the setup-problem launch (the file name starts with `e1-`); made-up data, no Copilot.
import { browser, expect } from "@wdio/globals";
import { DEMO_SETUP_PROBLEM_FIXTURE_ENV, parseDemoFixture } from "../../../scripts/ui-automation/demo-fixture.mts";
import { SidebarViews, VIEW_CONTAINER_TITLE } from "../support/sidebar-views.js";
import { wdioVscodeHost as host } from "../support/vscode-host.js";
import { runDemoScene, type DemoAction, type DemoScene } from "./support/demo-driver.ts";

parseDemoFixture(process.env[DEMO_SETUP_PROBLEM_FIXTURE_ENV], DEMO_SETUP_PROBLEM_FIXTURE_ENV);
const sidebar = new SidebarViews();

const LOGGING_SETTING = "github.copilot.chat.agentDebugLog.fileLogging.enabled";
const RETENTION_SETTING = "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs";
const TRACES_SETTING = "github.copilot.chat.otel.dbSpanExporter.enabled";
// Distinguishing text of each Setup row's message.
const LOGGING_ROW_TEXT = "debug logging is disabled";
const RETENTION_ROW_TEXT = "At least 200 is recommended";
const TRACES_ROW_TEXT = "Cache-write and reasoning-token counts";

const hasClass = (name: string): string => `contains(concat(' ',normalize-space(@class),' '),' ${name} ')`;
const ACTIVITY_ICON = `//div[contains(@class,'activitybar')]//a[contains(@class,'action-label')][starts-with(@aria-label,'${VIEW_CONTAINER_TITLE}')]`;
const row = (text: string): string => `//div[${hasClass("monaco-list-row")}][contains(.,'${text}')]`;
const fixAction = (text: string): string => `${row(text)}//a[contains(@class,'action-label')][@aria-label='Fix Setting' or @title='Fix Setting']`;
const SETUP_HEADER = `//div[${hasClass("pane-header")}][normalize-space(.)='Setup']`;
const REFRESH = `${SETUP_HEADER}//a[contains(@class,'action-label')][@aria-label='Refresh' or @title='Refresh']`;
const SETTINGS_CHECKBOX = ".settings-editor .setting-item-bool .setting-value-checkbox";
const SETTINGS_NUMBER = ".settings-editor .setting-item-number input";

async function settingsEditorShows(settingId: string): Promise<boolean> {
  const filter = await browser.execute(() => Array.from(document.querySelectorAll<HTMLElement>(".settings-editor .suggest-input-container")).map((e) => e.innerText).join(" "));
  return filter.includes(`@id:${settingId}`);
}

const setupHasRow = async (text: string): Promise<boolean> => (await sidebar.rowTexts("setup")).some((r) => r.includes(text));

// Fix Setting on the row: opens exactly that setting in the Settings editor.
const fixSetting = (rowText: string, settingId: string, control: string): DemoAction => async (driver) => {
  const target = await (await browser.$(row(rowText))).getElement();
  await driver.pointerTo(target);
  await target.moveTo();
  await driver.click(await (await browser.$(fixAction(rowText))).getElement());
  await browser.waitUntil(() => settingsEditorShows(settingId), { timeout: 30_000, timeoutMsg: `the Settings editor was not opened on ${settingId}` });
  await (await browser.$(control)).waitForDisplayed({ timeout: 15_000 });
};

const scene: DemoScene = {
  id: "E1",
  slug: "get-started",
  title: "Get started",
  steps: [
    {
      label: "open the AI Credits Analyzer side bar on the Setup view, which flags three settings",
      beatMs: 1_800,
      action: async (driver) => {
        await driver.click(await (await browser.$(ACTIVITY_ICON)).getElement());
        await sidebar.showAlone("setup");
        await browser.waitUntil(async () => (await setupHasRow(LOGGING_ROW_TEXT)) && (await setupHasRow(RETENTION_ROW_TEXT)) && (await setupHasRow(TRACES_ROW_TEXT)), { timeout: 30_000, timeoutMsg: "Setup did not flag the three settings" });
      },
    },
    { label: "Fix Setting on debug logging opens exactly that setting", beatMs: 1_200, action: fixSetting(LOGGING_ROW_TEXT, LOGGING_SETTING, SETTINGS_CHECKBOX) },
    {
      label: "turn debug logging on, as a user would",
      beatMs: 1_200,
      action: async (driver) => {
        await driver.click(await (await browser.$(SETTINGS_CHECKBOX)).getElement());
        await browser.waitUntil(async () => (await host.setting(LOGGING_SETTING)) === true, { timeout: 15_000, timeoutMsg: "the logging setting did not turn on" });
        await browser.waitUntil(async () => !(await setupHasRow(LOGGING_ROW_TEXT)), { timeout: 30_000, timeoutMsg: "Setup still flags debug logging" });
      },
    },
    { label: "Fix Setting on 'keep at least 200 sessions' opens the retention setting", beatMs: 1_000, action: fixSetting(RETENTION_ROW_TEXT, RETENTION_SETTING, SETTINGS_NUMBER) },
    {
      label: "type 200 into the field",
      beatMs: 1_200,
      action: async (driver) => {
        await driver.click(await (await browser.$(SETTINGS_NUMBER)).getElement());
        await browser.keys(["Control", "a"]);
        await driver.typeSlowly("200");
        await browser.keys(["Tab"]);
        await browser.waitUntil(async () => (await host.setting(RETENTION_SETTING)) === 200, { timeout: 15_000, timeoutMsg: "the retention setting did not become 200" });
        await browser.waitUntil(async () => !(await setupHasRow(RETENTION_ROW_TEXT)), { timeout: 30_000, timeoutMsg: "Setup still flags the retention" });
      },
    },
    { label: "Fix Setting on the agent traces row", beatMs: 1_000, action: fixSetting(TRACES_ROW_TEXT, TRACES_SETTING, SETTINGS_CHECKBOX) },
    {
      label: "turn it on; Setup turns green",
      beatMs: 2_200,
      action: async (driver) => {
        await driver.click(await (await browser.$(SETTINGS_CHECKBOX)).getElement());
        await browser.waitUntil(async () => (await host.setting(TRACES_SETTING)) === true, { timeout: 15_000, timeoutMsg: "the traces setting did not turn on" });
        // Copilot raises a "Reload Window" toast for this setting; keep it out of the frame.
        const toastShown = (): Promise<boolean> => browser.execute(() => document.querySelectorAll(".notifications-toasts .notification-toast").length > 0);
        await browser.waitUntil(toastShown, { timeout: 10_000, interval: 250 }).catch(() => undefined);
        await host.command("notifications.clearAll");
        // This one is read from the settings file only on a refresh (its help says to reload the window).
        const header = await (await browser.$(SETUP_HEADER)).getElement();
        await driver.pointerTo(header);
        await header.moveTo();
        await driver.click(await (await browser.$(REFRESH)).getElement());
        await browser.waitUntil(async () => !(await setupHasRow("Optional")), { timeout: 30_000, timeoutMsg: "Setup still flags a setting" });
      },
    },
  ],
};

suite("Demo E1 Get started (made-up data, setup-problem launch)", () => {
  test("E1 plays through Setup and the settings", async () => {
    await host.waitForExtension({ keepStartupEditors: true });
    // VS Code's own Welcome page is open here, not this extension's walkthrough.
    await host.command("workbench.action.closeAllEditors");
    await host.command("workbench.action.closeAuxiliaryBar");
    await host.command("workbench.action.closeSidebar");
    expect(await host.setting(LOGGING_SETTING)).not.toBe(true);
    const mp4 = await runDemoScene(scene, {
      assertEnd: async () => {
        expect(await host.setting(LOGGING_SETTING)).toBe(true);
        expect(await host.setting(RETENTION_SETTING)).toBe(200);
        expect(await host.setting(TRACES_SETTING)).toBe(true);
        expect(await setupHasRow("Optional")).toBe(false);
      },
    });
    console.log(`E1 master: ${mp4}`);
  });
});
