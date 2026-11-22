// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Free demo scene E3 on made-up data: `npm run demo:record`. Pick a session in the
// Sessions view; read its turns, the Explanation tab, the subagent marker and runs, the
// turn inspector, back to the session, the system prompt tab and the prompt in an editor
// (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/docs-refresh-and-demo-recordings.md §4.1). All eight beats; pauses are tight to fit the 25 s GIF limit.
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
      beatMs: 600,
      action: async () => {
        await sidebar.labels("sessions");
        await browser.$(sessionRow()).waitForDisplayed({ timeout: WAIT_MS });
      },
    },
    {
      label: "pick the session: the panel opens on it",
      beatMs: 800,
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
      beatMs: 800,
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
      beatMs: 1_500,
      action: async (driver) => {
        await panel.inside(async (view) => {
          // At 1200 px the AI Credits column (with the marker) sits right of the frame: scroll it in.
          const marker = await browser.$("table tbody .subagent-marker").getElement();
          await browser.execute((el: Element) => el.scrollIntoView({ block: "nearest", inline: "center" }), marker as never);
          await driver.pointerTo(marker);
          await driver.beat(700);
          await driver.pointerTo(await browser.$(".subagent-block-title").getElement());
          // Step 10.20: the block says calls and failed per run, and the Tools cell counts the run's calls.
          const { calls, failed } = fixture.readSession.firstRun;
          const block = await view.subagentBlock();
          expect(block?.runs[0]).toContain(`${calls} calls, ${failed} failed`);
          const toolsCell = await browser.$(`table tbody tr:nth-child(${(await view.subagentMarkers())[0]!.row + 1}) [title^='incl. ']`);
          expect(await toolsCell.getAttribute("title")).toBe(`incl. ${calls} from subagent runs`);
        });
        await driver.probePrivacy();
      },
    },
    {
      label: "open the turn inspector",
      beatMs: 1_000,
      action: async (driver) => {
        await panel.inside(async (view) => {
          await driver.click(await browser.$(button("Inspect request/response")).getElement());
          await view.waitForText("inspector");
        });
        await driver.probePrivacy();
      },
    },
    {
      label: "back to the session",
      beatMs: 500,
      action: (driver) =>
        panel.inside(async (view) => {
          await driver.click(await browser.$(button("← Back to session")).getElement());
          await view.waitForTurnRows(fixture.readSession.turns);
          expect(await browser.$(tab("System prompt")).isDisplayed()).toBe(true);
        }),
    },
    {
      label: "System prompt tab",
      beatMs: 800,
      action: async (driver) => {
        await panel.inside(async (view) => {
          await driver.click(await browser.$(tab("System prompt")).getElement());
          await view.waitForText("System prompt breakdown");
        });
        await driver.probePrivacy();
      },
    },
    {
      label: "open the system prompt inspector, then the prompt in an editor",
      beatMs: 1_500,
      action: (driver) =>
        panel.inside(async () => {
          await driver.click(await browser.$(button("Open system prompt inspector")).getElement());
          await driver.beat(700);
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
