// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Page } from "@playwright/test";
import { FRAME } from "../../../../vscode-extension/scripts/demo/ffmpeg-args.mts";
import { sceneOutputs } from "../../../../vscode-extension/scripts/demo/output-names.mts";
import { startRecorder } from "../../../../vscode-extension/scripts/demo/recorder.mts";
import { mastersDir } from "../../../../vscode-extension/test/ui/demo/support/demo-launch.mts";
import type { DemoScene } from "../../../../web/e2e/demo/support/demo-driver.js";
import { frameMismatch, type WindowReading } from "./demo-layout.js";

// The web suite's recordScene, for a page that runs at DEMO_SCALE: its frame
// check reads CSS pixels, so it would refuse a scaled window. Covered by the
// scenes' end-state assertions and frameMismatch's unit test.

// Without a window manager --kiosk doesn't hide the toolbar; fullscreen through CDP does.
async function fillFrame(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  const { windowId } = await session.send("Browser.getWindowForTarget");
  await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "fullscreen" } });
  await page.waitForTimeout(500);
}

async function assertPageFillsFrame(page: Page): Promise<void> {
  const reading = await page.evaluate<WindowReading>(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    screenX: window.screenX,
    screenY: window.screenY,
  }));
  const problem = frameMismatch(reading, FRAME);
  if (problem !== undefined) throw new Error(`The browser window does not fill the recorded frame: ${problem}`);
}

// Records the X display while `body` (the scene and its end-state assertions) runs.
// A failing scene discards its MP4.
export async function recordScene(page: Page, scene: DemoScene, body: () => Promise<void>): Promise<string> {
  await fillFrame(page);
  await assertPageFillsFrame(page);
  const out = sceneOutputs(scene, { masters: mastersDir(), gifs: mastersDir() }).mp4;
  const display = process.env.DISPLAY;
  if (!display) throw new Error("DISPLAY is not set: run under xvfb-run (npm run demo:record does)");
  const recorder = startRecorder({ display, width: FRAME.width, height: FRAME.height, fps: FRAME.fps, out });
  try {
    await recorder.ready();
    await page.waitForTimeout(800);
    await body();
    await recorder.stop();
  } catch (error) {
    await recorder.discard();
    throw error;
  }
  return out;
}
