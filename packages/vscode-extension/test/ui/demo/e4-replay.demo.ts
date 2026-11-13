// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Free demo scene E4 on made-up data: `npm run demo:record`. Replay a session on another
// model: Replay on, the summary strip's self-check and coverage line, the Simulated
// columns, then Compare models (docs/plans/docs-refresh-and-demo-recordings.md §4.1).
import { browser, expect } from "@wdio/globals";
import { DEMO_FIXTURE_ENV, parseDemoFixture } from "../../../scripts/ui-automation/demo-fixture.mts";
import { AnalyzerPanel } from "../support/analyzer-panel.js";
import { wdioVscodeHost as host } from "../support/vscode-host.js";
import { runDemoScene, type DemoScene } from "./support/demo-driver.ts";

const fixture = parseDemoFixture(process.env[DEMO_FIXTURE_ENV], DEMO_FIXTURE_ENV);
const panel = new AnalyzerPanel(host);
const WAIT_MS = 30_000;
const MODEL = fixture.replayModel;

const scrollToCentre = (selector: string) =>
  browser.execute((css: string) => document.querySelector(css)?.scrollIntoView({ block: "nearest", inline: "center" }), selector);

const scene: DemoScene = {
  id: "E4",
  slug: "replay",
  title: "Demo E4 replay on another model (made-up data)",
  steps: [
    {
      label: "open the session in the panel",
      beatMs: 1_200,
      action: async () => {
        await host.command("workbench.action.closeSidebar");
        await panel.openSession(fixture.readSession.id);
        await panel.inside((view) => view.waitForTurnRows(fixture.readSession.turns));
      },
    },
    {
      label: "Replay on: pick the other model",
      beatMs: 1_800,
      action: (driver) =>
        panel.inside(async (view) => {
          await driver.pointerTo(await browser.$(".replay-on-picker select").getElement());
          await driver.beat(600);
          await view.chooseReplayModel(MODEL);
          await browser.waitUntil(async () => (await view.replaySimulatedTotal(MODEL)) !== null, { timeout: WAIT_MS, timeoutMsg: "no simulated total" });
          await browser.waitUntil(async () => (await view.simulatedColumns()).models.join() === MODEL, { timeout: WAIT_MS, timeoutMsg: "no Simulated columns" });
        }),
    },
    {
      label: "the summary strip: self-check and coverage",
      beatMs: 2_200,
      action: (driver) =>
        panel.inside(async () => {
          await driver.pointerTo(await browser.$(".replay-self-check").getElement());
        }),
    },
    {
      label: "scroll the table to the Simulated columns",
      beatMs: 2_200,
      action: (driver) =>
        panel.inside(async () => {
          await scrollToCentre("table thead th.sim-group");
          await driver.pointerTo(await browser.$("table thead th.sim-group").getElement());
        }),
    },
    {
      label: "Compare models: totals per model",
      beatMs: 3_000,
      action: (driver) =>
        panel.inside(async (view) => {
          await driver.click(await browser.$("button=Compare models").getElement());
          await browser.waitUntil(async () => (await view.compareModelRows()).some((row) => row.model === MODEL), { timeout: WAIT_MS, timeoutMsg: "Compare models lists no replay model" });
          await driver.beat(800);
          // Bring the ranked totals into the frame.
          await browser.execute(() => document.querySelector("[aria-label='Comparison settings']")?.scrollIntoView({ block: "start" }));
        }),
    },
  ],
};

suite("Demo E4 replay on another model (made-up data)", () => {
  test("E4 plays through the driver", async () => {
    await host.waitForExtension();
    await panel.reset();
    const mp4 = await runDemoScene(scene, {
      assertEnd: () =>
        panel.inside(async (view) => {
          const rows = await view.compareModelRows();
          expect(rows.some((row) => row.model === MODEL)).toBe(true);
          expect(rows.filter((row) => row.measured)).toHaveLength(1);
        }),
    });
    console.log(`E4 master: ${mp4}`);
  });
});
