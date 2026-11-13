// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Scene E0: the smallest recording that proves the pipeline (open the analyzer
// panel, hold a beat, write an MP4 master). Both demo configs run it; task 1.4's
// runDemoScene takes over the recording, pacing and failure handling.
import { statSync } from "node:fs";
import { browser, expect } from "@wdio/globals";
import { FRAME } from "../../../../scripts/demo/ffmpeg-args.mts";
import { sceneOutputs } from "../../../../scripts/demo/output-names.mts";
import { startRecorder } from "../../../../scripts/demo/recorder.mts";
import { AnalyzerPanel } from "../../support/analyzer-panel.js";
import { wdioVscodeHost as host } from "../../support/vscode-host.js";
import { mastersDir } from "./demo-launch.mts";

const BEAT_MS = 2_000;

export function smokeScene(title: string): void {
  suite(title, () => {
    test("E0 opens the analyzer panel on a recording", async () => {
      const display = process.env.DISPLAY;
      if (display === undefined || display === "") throw new Error("DISPLAY is not set: run the demo under xvfb-run (npm run demo:record)");
      const panel = new AnalyzerPanel(host);
      // The workbench settles (Welcome tab, chat side bar closed) before the first frame.
      await host.waitForExtension();
      await panel.reset();
      await host.command("notifications.clearAll");

      const out = sceneOutputs({ id: "E0", slug: "smoke" }, { masters: mastersDir(), gifs: mastersDir() }).mp4;
      const recorder = startRecorder({ display, ...FRAME, out });
      try {
        await recorder.ready();
        await panel.openDashboard();
        await panel.inside(async (view) => {
          await browser.waitUntil(async () => (await view.explanationText()).trim().length > 0, { timeout: 30_000, timeoutMsg: "the panel rendered nothing" });
        });
        await browser.pause(BEAT_MS);
        const workbench = await browser.getWorkbench();
        expect((await workbench.getAllWebviews()).length).toBeGreaterThan(0);
        await recorder.stop();
      } catch (error) {
        await recorder.discard();
        throw error;
      }
      expect(statSync(out).size).toBeGreaterThan(0);
      console.log(`E0 master: ${out}`);
    });
  });
}
