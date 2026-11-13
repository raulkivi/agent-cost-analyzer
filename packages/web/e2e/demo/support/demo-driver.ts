// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { POINTER_OVERLAY_SCRIPT } from "../../../../vscode-extension/scripts/demo/pointer-overlay.mts";
import { glidePath, type Point } from "../../../../vscode-extension/scripts/demo/pointer-target.mts";
import { sceneOutputs } from "../../../../vscode-extension/scripts/demo/output-names.mts";
import { assertScene, playScene, totalBeatMs, type Scene } from "../../../../vscode-extension/scripts/demo/scene-timeline.mts";

// Playwright glue for the W scenes; covered by each scene's end-state assertion.

export type DemoAction = (page: Page, pointer: Pointer) => Promise<void>;
export type DemoScene = Scene<DemoAction>;

const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
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

export function mastersDir(): string {
  return process.env.AICA_DEMO_MASTERS ?? path.join(repoRoot, "demo-masters");
}

// The shared naming rule, with the extension Playwright's recorder produces.
export function masterPath(scene: DemoScene): string {
  return sceneOutputs(scene, { masters: mastersDir(), gifs: mastersDir() }).mp4.replace(/\.mp4$/, ".webm");
}

export async function play(page: Page, scene: DemoScene, pointer: Pointer): Promise<void> {
  assertScene(scene);
  await playScene(scene, (action) => action(page, pointer), (ms) => page.waitForTimeout(ms));
}

// Called only after the end-state assertion passed, so a failing scene leaves no video.
export async function finish(page: Page, scene: DemoScene): Promise<string> {
  const video = page.video();
  await page.context().close();
  if (!video) throw new Error("No video: is video enabled in the demo config?");
  const out = masterPath(scene);
  mkdirSync(path.dirname(out), { recursive: true });
  await video.saveAs(out);
  return out;
}

export { totalBeatMs };
