// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Free demo scene E3 on made-up data: `npm run demo:record`. Pick a session in the
// Sessions view; read its turns, the Explanation tab, the subagent marker and runs, the
// turn inspector and the system prompt (docs/plans/docs-refresh-and-demo-recordings.md §4.1).
import { browser, expect } from "@wdio/globals";
import { DEMO_FIXTURE_ENV, parseDemoFixture } from "../../../scripts/ui-automation/demo-fixture.mts";
import { AnalyzerPanel } from "../support/analyzer-panel.js";
import { SidebarViews } from "../support/sidebar-views.js";
import { wdioVscodeHost as host } from "../support/vscode-host.js";
import { runDemoScene, type DemoScene } from "./support/demo-driver.ts";

const fixture = parseDemoFixture(process.env[DEMO_FIXTURE_ENV], DEMO_FIXTURE_ENV);
const panel = new AnalyzerPanel(host);
const sidebar = new SidebarViews();
const WAIT_MS = 30_000;

const tab = (label: string) => `//label[contains(@class,'seg-opt')][normalize-space()='${label}']`;
const button = (name: string) => `//button[normalize-space()='${name}']`;
const sessionRow = () => `//div[contains(@class,'monaco-list-row')][contains(., '${fixture.readSession.title}')]`;

const scene: DemoScene = {
  id: "E3",
  slug: "read-session",
  title: "Demo E3 read a session (made-up data)",
  steps: [
    {
      label: "show the Sessions view",
      beatMs: 1_200,
      action: async () => {
        await sidebar.labels("sessions");
        await browser.$(sessionRow()).waitForDisplayed({ timeout: WAIT_MS });
      },
    },
    {
      label: "pick the session: the panel opens on it",
      beatMs: 1_500,
      action: async () => {
        // Enter on the focused row, no drawn pointer: the driver's overlay sets `innerHTML`,
        // which the workbench document refuses (Trusted Types) when the first move is made
        // there (reported in the task notes). The row is highlighted by the keyboard focus.
        await host.command("aiCreditsAnalyzer.sessions.focus");
        await browser.keys(["Home"]);
        const focused = () => browser.execute(() => (document.querySelector(".monaco-list-row.focused") as HTMLElement | null)?.innerText ?? "");
        for (let presses = 0; presses < 40 && !(await focused()).includes(fixture.readSession.title); presses++) await browser.keys(["ArrowDown"]);
        await browser.pause(900);
        await browser.keys(["Enter"]);
        await browser.waitUntil(async () => (await (await browser.getWorkbench()).getAllWebviews()).length > 0, { timeout: WAIT_MS });
        await host.command("workbench.action.closeSidebar");
        await panel.settleLayout();
        await panel.inside((view) => view.waitForTurnRows(fixture.readSession.turns));
      },
    },
    {
      label: "select the first turn (it has subagent runs): Explanation tab",
      beatMs: 1_500,
      action: (driver) =>
        panel.inside(async (view) => {
          const markers = await view.subagentMarkers();
          const first = markers[0]?.row ?? 0;
          await driver.click(await browser.$(`table tbody tr:nth-child(${first + 1})`).getElement());
          await driver.click(await browser.$(tab("Explanation")).getElement());
          await browser.waitUntil(async () => (await view.subagentBlock()) !== null, { timeout: WAIT_MS, timeoutMsg: "no subagent block for turn 1" });
        }),
    },
    {
      label: "the subagent marker and Subagent runs this turn",
      beatMs: 2_500,
      action: (driver) =>
        panel.inside(async () => {
          // At 1200 px the AI Credits column (with the marker) sits right of the frame: scroll it in.
          const marker = await browser.$("table tbody .subagent-marker").getElement();
          await browser.execute((el: Element) => el.scrollIntoView({ block: "nearest", inline: "center" }), marker as never);
          await driver.pointerTo(marker);
          await driver.beat(1_200);
          await driver.pointerTo(await browser.$(".subagent-block-title").getElement());
        }),
    },
    {
      label: "open the turn inspector",
      beatMs: 2_000,
      action: (driver) =>
        panel.inside(async (view) => {
          await driver.click(await browser.$(button("Inspect request/response")).getElement());
          await view.waitForText("inspector");
        }),
    },
    {
      label: "back to the session",
      beatMs: 800,
      action: (driver) =>
        panel.inside(async (view) => {
          await driver.click(await browser.$(button("← Back to session")).getElement());
          await view.waitForTurnRows(fixture.readSession.turns);
        }),
    },
    {
      label: "System prompt tab",
      beatMs: 1_500,
      action: (driver) =>
        panel.inside(async (view) => {
          await driver.click(await browser.$(tab("System prompt")).getElement());
          await view.waitForText("System prompt breakdown");
        }),
    },
    {
      label: "open the system prompt inspector, then the prompt in an editor",
      beatMs: 2_500,
      action: (driver) =>
        panel.inside(async () => {
          await driver.click(await browser.$(button("Open system prompt inspector")).getElement());
          await driver.beat(1_200);
          await driver.click(await browser.$(button("Open prompt in editor")).getElement());
        }),
    },
  ],
};

suite("Demo E3 read a session (made-up data)", () => {
  test("E3 plays through the driver", async () => {
    await host.waitForExtension();
    await panel.reset();
    const mp4 = await runDemoScene(scene, {
      assertEnd: async () => {
        await browser.waitUntil(async () => (await host.activeEditor()).scheme === "ai-credits-analyzer-doc", { timeout: WAIT_MS, timeoutMsg: "the system prompt did not open in an editor" });
        expect((await host.activeEditor()).text).toContain(fixture.systemPromptMarker);
      },
    });
    console.log(`E3 master: ${mp4}`);
  });
});
