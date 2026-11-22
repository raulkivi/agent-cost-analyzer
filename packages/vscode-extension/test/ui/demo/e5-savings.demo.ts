// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Free demo scene E5 on made-up data: `npm run demo:record`. Analyze, Savings, 90 then 30
// days, the top row's sessions (title, id, date, saving), the unused-tools row's tool list
// ("and N more"), Include simulated, Not analysed. Beat list: https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/demo-recordings-1.0.md §3.3. // codespell:ignore analysed
import { browser, expect } from "@wdio/globals";
import { AnalyzerPanel } from "../support/analyzer-panel.js";
import { readSavings, waitForSavings } from "../support/savings-view.js";
import { wdioVscodeHost as host } from "../support/vscode-host.js";
import { DEMO_FIXTURE_ENV, parseDemoFixture } from "../../../scripts/ui-automation/demo-fixture.mts";
import { runDemoScene, type DemoDriver, type DemoScene } from "./support/demo-driver.ts";
import { chooseSelectValue, inTopContext } from "./support/1.6d-helpers.ts";
import { e5BeatMs } from "./support/e5-beats.mts";
import { saveStill } from "./support/stills.ts";

const fixture = parseDemoFixture(process.env[DEMO_FIXTURE_ENV], DEMO_FIXTURE_ENV);
const panel = new AnalyzerPanel(host);
const WAIT_MS = 30_000;
const WINDOW_SELECT = "[aria-label='Savings filters'] select";
const DETAIL = "section[aria-label='Savings detail']";
const TOOLS = `${DETAIL} section[aria-label='Tools']`;
const SESSIONS = `${DETAIL} section[aria-label='Sessions']`;
const optionLabel = (text: string) => `//label[contains(@class,'seg-opt')][normalize-space()='${text}']`;
const rowButton = (subject: string) => `//*[@data-testid='savings-row'][.//*[contains(@class,'savings-subject-text')][contains(normalize-space(),'${subject}')]]//button`;

// Scrolls a block of the open detail to the top of the panel and points at it.
async function showBlock(driver: DemoDriver, selector: string): Promise<void> {
  const block = await (await browser.$(selector)).getElement();
  await browser.execute((element: HTMLElement) => element.scrollIntoView({ block: "start", behavior: "instant" }), block as never);
  await driver.pointerTo(block);
}

async function openRow(driver: DemoDriver, buttonSelector: string): Promise<void> {
  await waitForSavings();
  await driver.click(await (await browser.$(buttonSelector)).getElement());
  await browser.waitUntil(async () => (await browser.$(DETAIL)).isExisting(), { timeout: WAIT_MS, timeoutMsg: "the detail did not open" });
}

async function closeDetail(driver: DemoDriver): Promise<void> {
  await driver.click(await (await browser.$(`${DETAIL} .savings-close`)).getElement());
}

const scene: DemoScene = {
  id: "E5",
  slug: "savings",
  title: "Demo E5 Savings (made-up data)",
  steps: [
    {
      label: "open the analyzer panel",
      beatMs: e5BeatMs("open the analyzer panel"),
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
      beatMs: e5BeatMs("Analyze, then Savings"),
      action: (driver) =>
        panel.inside(async () => {
          await driver.click(await (await browser.$(optionLabel("Analyze"))).getElement());
          // The Savings option appears once the host's product profile has loaded.
          await browser.waitUntil(async () => (await browser.$(optionLabel("Savings"))).isExisting(), { timeout: WAIT_MS, interval: 500, timeoutMsg: "the panel offers no Savings view" });
          await driver.click(await (await browser.$(optionLabel("Savings"))).getElement());
          await waitForSavings();
        }),
    },
    { label: "90 days", beatMs: e5BeatMs("90 days"), action: (driver) => panel.inside(() => chooseSelectValue(driver, WINDOW_SELECT, "90")) },
    {
      label: "back to 30 days",
      beatMs: e5BeatMs("back to 30 days"),
      action: async (driver) => {
        await panel.inside(() => chooseSelectValue(driver, WINDOW_SELECT, "30"));
        await panel.inside(() => waitForSavings());
        await inTopContext();
        await saveStill("savings");
      },
    },
    {
      label: "open the top row: its sessions",
      beatMs: e5BeatMs("open the top row: its sessions"),
      action: (driver) =>
        panel.inside(async () => {
          await openRow(driver, "[data-testid='savings-row'] button");
          await showBlock(driver, SESSIONS);
        }),
    },
    {
      label: "open the unused-tools row: its tools",
      beatMs: e5BeatMs("open the unused-tools row: its tools"),
      action: (driver) =>
        panel.inside(async () => {
          await openRow(driver, rowButton(fixture.savings.unusedToolsRow.server));
          await showBlock(driver, TOOLS);
        }),
    },
    {
      label: "close the detail, tick Include simulated",
      beatMs: e5BeatMs("close the detail, tick Include simulated"),
      action: (driver) =>
        panel.inside(async () => {
          await closeDetail(driver);
          await driver.click(await (await browser.$(".savings-check input")).getElement());
        }),
    },
    {
      label: "scroll to Not analysed",
      beatMs: e5BeatMs("scroll to Not analysed"), // codespell:ignore analysed
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
          expect(screen.rows.some((row) => row.subject.includes(fixture.savings.unusedToolsRow.server))).toBe(true);
          expect(screen.notAnalysed.length).toBeGreaterThan(0);
          expect(await browser.$(DETAIL).isExisting()).toBe(false);
          expect(await browser.$(".savings-check input").isSelected()).toBe(true);
        }),
    });
    console.log(`E5 master: ${mp4}`);
  });
});
