// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Scene E0: the smallest recording that exercises the whole driver (open the analyzer
// panel, glide to and click the Analyze tab, type a few characters, hold a beat). Both
// demo configs play it; the Copilot one under its own slug so the masters don't collide.
import { browser, expect } from "@wdio/globals";
import { AnalyzerPanel } from "../../support/analyzer-panel.js";
import { wdioVscodeHost as host } from "../../support/vscode-host.js";
import { runDemoScene, type DemoScene } from "./demo-driver.ts";

const ANALYZE_TAB = "//label[contains(@class,'seg-opt')][normalize-space()='Analyze']";
const panel = new AnalyzerPanel(host);

export function smokeScene(title: string, slug = "smoke"): void {
  const scene: DemoScene = {
    id: "E0",
    slug,
    title,
    steps: [
      {
        label: "open the analyzer panel",
        beatMs: 1_000,
        action: async () => {
          await panel.openDashboard();
          await panel.inside(async (view) => {
            await browser.waitUntil(async () => (await view.explanationText()).trim().length > 0, { timeout: 30_000, timeoutMsg: "the panel rendered nothing" });
          });
        },
      },
      {
        label: "glide to the Analyze tab and click it",
        beatMs: 1_000,
        action: (driver) => panel.inside(async () => driver.click(await (await browser.$(ANALYZE_TAB)).getElement())),
      },
      {
        label: "type a few characters",
        beatMs: 1_500,
        // Only into a text field the Analyze view offers; nowhere else, so no shortcut fires.
        action: (driver) =>
          panel.inside(async () => {
            const field = await (await browser.$("input[type='search'], input[type='text']")).getElement();
            if (!(await field.isExisting())) return;
            await driver.click(field);
            await driver.typeSlowly("demo");
          }),
      },
    ],
  };
  suite(title, () => {
    test("E0 plays through the driver", async () => {
      await host.waitForExtension();
      await panel.reset();
      const mp4 = await runDemoScene(scene, {
        assertEnd: () => panel.inside(async (view) => expect(await view.hasText("Analyze")).toBe(true)),
      });
      console.log(`E0 master: ${mp4}`);
    });
  });
}
