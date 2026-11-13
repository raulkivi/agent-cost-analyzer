// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The wdio demo driver (docs/plans/docs-refresh-and-demo-recordings.md §5, task 1.4):
// scenes call runDemoScene, which records them, plays their steps at demo pace with a
// drawn pointer, checks privacy and the end state, and never leaves a bad recording.
// TDD exception: wdio glue, covered by the smoke scenes; the pure parts it calls
// (scripts/demo/) are unit-tested.
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { browser } from "@wdio/globals";
import { FRAME } from "../../../../scripts/demo/ffmpeg-args.mts";
import { sceneOutputs } from "../../../../scripts/demo/output-names.mts";
import { POINTER_OVERLAY_SCRIPT } from "../../../../scripts/demo/pointer-overlay.mts";
import { glidePath, targetPoint, type Point } from "../../../../scripts/demo/pointer-target.mts";
import { findForbidden, forbiddenTerms } from "../../../../scripts/demo/privacy-probe.mts";
import { startRecorder } from "../../../../scripts/demo/recorder.mts";
import { assertScene, playScene, type Scene } from "../../../../scripts/demo/scene-timeline.mts";
import { PINNED_VSCODE_VERSION } from "../../../../scripts/ui-automation/vscode-version.mts";
import { enterWebview, leaveWebview } from "../../support/webview-frame.js";
import { mastersDir } from "./demo-launch.mts";

// A step of a scene: a small async function over the driver.
export type DemoAction = (driver: DemoDriver) => Promise<void>;
export type DemoScene = Scene<DemoAction>;

export interface RunOptions {
  // Checked after the last step, before the privacy probe: the scene's end state.
  assertEnd?: (driver: DemoDriver) => Promise<void>;
}

// A wdio element reference, as `browser.$` returns it.
type Target = WebdriverIO.Element;

const GLIDE_STEPS = 25;
const GLIDE_FRAME_MS = 20;
const CLICK_PAUSE_MS = 150;
const START_POINT: Point = { x: 600, y: 400 };

type PointerApi = { moveTo(x: number, y: number): void; ripple(): void };
declare global {
  interface Window {
    __demoPointer: PointerApi;
  }
}

export class DemoDriver {
  private at: Point = START_POINT;

  // Glides the drawn pointer to the middle of `el`, wherever it lives: the workbench or
  // the analyzer webview (an iframe inside an iframe; the overlay is drawn in the top document).
  async pointerTo(el: Target): Promise<void> {
    const inFrame = await browser.execute(() => window.parent !== window);
    const rect = await browser.execute((e: Element) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, el as never);
    const offsets = inFrame ? await this.webviewOffsets() : [];
    const to = targetPoint(rect, offsets);
    await this.withTopDocument(inFrame, async () => {
      await browser.execute(POINTER_OVERLAY_SCRIPT);
      for (const point of glidePath(this.at, to, GLIDE_STEPS)) {
        await browser.execute((x: number, y: number) => window.__demoPointer.moveTo(x, y), point.x, point.y);
        await browser.pause(GLIDE_FRAME_MS);
      }
    });
    this.at = to;
  }

  // Pointer, ripple, a short pause, then the DOM click the specs use.
  async click(el: Target): Promise<void> {
    await this.pointerTo(el);
    const inFrame = await browser.execute(() => window.parent !== window);
    await this.withTopDocument(inFrame, () => browser.execute(() => window.__demoPointer.ripple()));
    await browser.pause(CLICK_PAUSE_MS);
    await browser.execute((e: HTMLElement) => e.click(), el as never);
  }

  async typeSlowly(text: string, delayMs = 60): Promise<void> {
    for (const character of text) {
      await browser.keys(character);
      await browser.pause(delayMs);
    }
  }

  beat(ms: number): Promise<void> {
    return browser.pause(ms);
  }

  // Fails if the workbench or any webview shows a forbidden string.
  async probePrivacy(): Promise<void> {
    const texts: { source: string; text: string }[] = [{ source: "workbench", text: await browser.execute(() => document.body.innerText) }];
    const workbench = await browser.getWorkbench();
    const webviews = await workbench.getAllWebviews();
    for (const [index, webview] of webviews.entries()) {
      await enterWebview(browser, webview);
      try {
        texts.push({ source: `webview ${index + 1}`, text: await browser.execute(() => document.body.innerText) });
      } finally {
        await leaveWebview(browser);
      }
    }
    const hits = findForbidden(texts, forbiddenTerms(process.env.DEMO_FORBIDDEN, { homedir: os.homedir(), username: os.userInfo().username }));
    if (hits.length > 0) throw new Error(`Privacy probe: ${hits.map((h) => `"${h.match}" in ${h.source}`).join("; ")}`);
  }

  // The positions of the outer webview iframe in the workbench and of `#active-frame` in it.
  private async webviewOffsets(): Promise<Point[]> {
    const workbench = await browser.getWorkbench();
    const [webview] = await workbench.getAllWebviews();
    if (!webview) throw new Error("A pointer target is in a frame, but no webview is open");
    await leaveWebview(browser);
    try {
      const outer = await browser.execute((e: Element) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y };
      }, webview.elem as never);
      await browser.switchFrame(webview.elem);
      const inner = await browser.execute(() => {
        const r = document.getElementById("active-frame")?.getBoundingClientRect();
        return { x: r?.x ?? 0, y: r?.y ?? 0 };
      });
      return [outer, inner];
    } finally {
      await this.reenter();
    }
  }

  // Runs `body` in the top (workbench) document, then returns to the webview if it started in one.
  private async withTopDocument<T>(wasInFrame: boolean, body: () => Promise<T>): Promise<T> {
    if (!wasInFrame) return body();
    await leaveWebview(browser);
    try {
      return await body();
    } finally {
      await this.reenter();
    }
  }

  private async reenter(): Promise<void> {
    await leaveWebview(browser);
    const workbench = await browser.getWorkbench();
    const [webview] = await workbench.getAllWebviews();
    if (webview) await enterWebview(browser, webview);
  }
}

// What 1.3's frames showed that a viewer should not, hidden with a style rule in the workbench
// document: the Accounts avatar (a storage toggle in VS Code 1.146, not a setting; its menu
// toggle proved flaky under Xvfb), the title bar's Copilot "Sign In" button, and the window
// title, whose "[Extension Development Host]" prefix no setting removes.
const CLUTTER_CSS = [
  ".activitybar .action-item[aria-label='Accounts']",
  ".titlebar-container .action-item[aria-label='Sign In']",
  ".titlebar-container .window-title",
]
  .map((selector) => `${selector} { display: none !important; }`)
  .join(" ");

export async function hideWorkbenchClutter(): Promise<void> {
  await browser.execute((css: string) => {
    if (document.getElementById("__demo-clutter")) return;
    const style = document.createElement("style");
    style.id = "__demo-clutter";
    style.textContent = css;
    document.head.appendChild(style);
  }, CLUTTER_CSS);
}

// Records `scene`, plays it, checks the end state and privacy, and writes the MP4 and a
// .json next to it. On any failure the recording is deleted and the error rethrown.
export async function runDemoScene(scene: DemoScene, options: RunOptions = {}): Promise<string> {
  assertScene(scene);
  const display = process.env.DISPLAY;
  if (display === undefined || display === "") throw new Error("DISPLAY is not set: run the demo under xvfb-run (npm run demo:record)");
  const out = sceneOutputs(scene, { masters: mastersDir(), gifs: mastersDir() });
  const driver = new DemoDriver();
  await browser.executeWorkbench((vscode) => vscode.commands.executeCommand("notifications.clearAll"));
  await hideWorkbenchClutter();
  const recorder = startRecorder({ display, ...FRAME, out: out.mp4 });
  const startedAt = Date.now();
  try {
    await recorder.ready();
    await playScene(scene, (action) => action(driver), (ms) => driver.beat(ms));
    await options.assertEnd?.(driver);
    await driver.probePrivacy();
    await recorder.stop();
  } catch (error) {
    await recorder.discard();
    throw error;
  }
  mkdirSync(path.dirname(out.meta), { recursive: true });
  const meta = { id: scene.id, title: scene.title, vscodeVersion: PINNED_VSCODE_VERSION, date: new Date().toISOString(), durationMs: Date.now() - startedAt };
  writeFileSync(out.meta, `${JSON.stringify(meta, null, 2)}\n`);
  return out.mp4;
}
