// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Free demo scene E5 on made-up data: `npm run demo:record`. Dashboard, Savings, the
// 7/30/90-day windows, a row's detail (range, coverage) with Copy text, Include simulated,
// Not analysed.
import { browser, expect } from "@wdio/globals";
import { AnalyzerPanel } from "../support/analyzer-panel.js";
import { readSavings, waitForSavings } from "../support/savings-view.js";
import { wdioVscodeHost as host } from "../support/vscode-host.js";
import { runDemoScene, type DemoScene } from "./support/demo-driver.ts";
import { chooseSelectValue, inTopContext } from "./support/1.6d-helpers.ts";
import { saveStill } from "./support/stills.ts";

const panel = new AnalyzerPanel(host);
const WAIT_MS = 30_000;
const WINDOW_SELECT = "[aria-label='Savings filters'] select";
const DETAIL = "section[aria-label='Savings detail']";
const optionLabel = (text: string) => `//label[contains(@class,'seg-opt')][normalize-space()='${text}']`;

const scene: DemoScene = {
  id: "E5",
  slug: "savings",
  title: "Demo E5 Savings (made-up data)",
  steps: [
    {
      label: "open the analyzer panel",
      beatMs: 600,
      action: async () => {
        await host.command("workbench.action.closeSidebar");
        await panel.openDashboard();
        await panel.inside(async (view) => {
          await browser.waitUntil(async () => (await view.explanationText()).trim().length > 0, { timeout: WAIT_MS, timeoutMsg: "the panel rendered nothing" });
        });
      },
    },
    {
      label: "Analyze, then Savings",
      beatMs: 1_500,
      action: (driver) =>
        panel.inside(async () => {
          await driver.click(await (await browser.$(optionLabel("Analyze"))).getElement());
          // The Savings option appears once the host's product profile has loaded.
          await browser.waitUntil(async () => (await browser.$(optionLabel("Savings"))).isExisting(), { timeout: WAIT_MS, interval: 500, timeoutMsg: "the panel offers no Savings view" });
          await driver.click(await (await browser.$(optionLabel("Savings"))).getElement());
          await waitForSavings();
        }),
    },
    { label: "7 days", beatMs: 900, action: (driver) => panel.inside(() => chooseSelectValue(driver, WINDOW_SELECT, "7")) },
    { label: "90 days", beatMs: 900, action: (driver) => panel.inside(() => chooseSelectValue(driver, WINDOW_SELECT, "90")) },
    {
      label: "back to 30 days",
      beatMs: 700,
      action: async (driver) => {
        await panel.inside(() => chooseSelectValue(driver, WINDOW_SELECT, "30"));
        await panel.inside(() => waitForSavings());
        await inTopContext();
        await saveStill("savings");
      },
    },
    {
      label: "open the first row's detail",
      beatMs: 1_800,
      action: (driver) =>
        panel.inside(async () => {
          await waitForSavings();
          await driver.click(await (await browser.$("[data-testid='savings-row'] button")).getElement());
          await browser.waitUntil(async () => (await browser.$(DETAIL)).isExisting(), { timeout: WAIT_MS });
        }),
    },
    {
      label: "Copy text",
      beatMs: 1_000,
      action: (driver) =>
        panel.inside(async () => {
          await driver.click(await (await browser.$(`//section[@aria-label='Savings detail']//button[normalize-space()='Copy text']`)).getElement());
          await browser.waitUntil(async () => (await (await browser.$(`${DETAIL} [role='status']`)).getText()).trim() === "Copied", { timeout: WAIT_MS, timeoutMsg: "Copy did not say Copied" });
        }),
    },
    {
      label: "close the detail, tick Include simulated",
      beatMs: 900,
      action: (driver) =>
        panel.inside(async () => {
          await driver.click(await (await browser.$(`${DETAIL} .savings-close`)).getElement());
          await driver.click(await (await browser.$(".savings-check input")).getElement());
        }),
    },
    {
      label: "scroll to Not analysed",
      beatMs: 1_800,
      action: (driver) =>
        panel.inside(async () => {
          const list = await (await browser.$("ul[aria-label='Not analysed']")).getElement();
          await browser.execute((element: HTMLElement) => element.scrollIntoView({ block: "center", behavior: "instant" }), list as never);
          await driver.pointerTo(list);
        }),
    },
  ],
};

suite("Demo E5 savings (made-up data)", () => {
  test("E5 plays through the driver", async () => {
    await host.waitForExtension();
    await panel.reset();
    const mp4 = await runDemoScene(scene, {
      assertEnd: () =>
        panel.inside(async () => {
          const screen = await readSavings();
          expect(screen.rows.length).toBeGreaterThanOrEqual(4);
          expect(screen.notAnalysed.length).toBeGreaterThan(0);
          expect(await browser.$(DETAIL).isExisting()).toBe(false);
        }),
    });
    console.log(`E5 master: ${mp4}`);
  });
});
