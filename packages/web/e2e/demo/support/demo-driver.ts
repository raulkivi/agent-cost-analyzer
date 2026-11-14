// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Locator, Page } from "@playwright/test";
import { POINTER_OVERLAY_SCRIPT } from "../../../../vscode-extension/scripts/demo/pointer-overlay.mts";
import { glidePath, type Point } from "../../../../vscode-extension/scripts/demo/pointer-target.mts";
import { FRAME } from "../../../../vscode-extension/scripts/demo/ffmpeg-args.mts";
import { startRecorder } from "../../../../vscode-extension/scripts/demo/recorder.mts";
import { frameProblem, mastersDir } from "../../../../vscode-extension/test/ui/demo/support/demo-launch.mts";
import { sceneOutputs } from "../../../../vscode-extension/scripts/demo/output-names.mts";
import { assertScene, playScene, totalBeatMs, type Scene } from "../../../../vscode-extension/scripts/demo/scene-timeline.mts";

// Playwright glue for the W scenes; covered by each scene's end-state assertion.

export type DemoAction = (page: Page, pointer: Pointer) => Promise<void>;
export type DemoScene = Scene<DemoAction>;

const GLIDE_STEPS = 18;
const GLIDE_FRAME_MS = 22;

type PointerApi = { moveTo(x: number, y: number): void; ripple(): void };
declare global {
  interface Window {
    __demoPointer: PointerApi;
  }
}

export class Pointer {
  private at: Point = { x: 600, y: 400 };
  constructor(private readonly page: Page) {}

  // Call after the page has loaded; the overlay lives in that document.
  async install(): Promise<void> {
    await this.page.evaluate(POINTER_OVERLAY_SCRIPT);
    await this.page.evaluate(({ x, y }) => window.__demoPointer.moveTo(x, y), this.at);
  }

  async glideTo(target: Locator): Promise<void> {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error("Pointer target has no box");
    const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    for (const point of glidePath(this.at, to, GLIDE_STEPS)) {
      await this.page.evaluate(({ x, y }) => window.__demoPointer.moveTo(x, y), point);
      await this.page.waitForTimeout(GLIDE_FRAME_MS);
    }
    this.at = to;
  }

  async click(target: Locator): Promise<void> {
    await this.glideTo(target);
    await this.page.evaluate(() => window.__demoPointer.ripple());
    await target.click();
  }

  async select(target: Locator, valueOrLabel: string): Promise<void> {
    await this.glideTo(target);
    await this.page.evaluate(() => window.__demoPointer.ripple());
    await target.selectOption(valueOrLabel);
  }
}

export async function play(page: Page, scene: DemoScene, pointer: Pointer): Promise<void> {
  assertScene(scene);
  await playScene(scene, (action) => action(page, pointer), (ms) => page.waitForTimeout(ms));
}

// x11grab records the whole X screen, so the browser must fill it with no chrome. Without a
// window manager --kiosk doesn't hide the toolbar; fullscreen through CDP does.
async function fillFrame(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  const { windowId } = await session.send("Browser.getWindowForTarget");
  await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "fullscreen" } });
  await page.waitForTimeout(500);
}

async function assertPageFillsFrame(page: Page): Promise<void> {
  const box = await page.evaluate(() => ({ x: window.screenX, y: window.screenY, width: window.innerWidth, height: window.innerHeight }));
  const problem = frameProblem(box);
  if (problem !== undefined) throw new Error(`The browser window is ${box.width}x${box.height} at ${box.x},${box.y}: ${problem}`);
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

export { totalBeatMs };

// Sets the colour preference before the app's first render (it reads localStorage then).
// A Playwright test gets a fresh context, so the choice never leaks into another scene.
export async function presetColorMode(page: Page, mode: "light" | "dark"): Promise<void> {
  await page.addInitScript((value) => window.localStorage.setItem("aca.colorMode", value), mode);
}
