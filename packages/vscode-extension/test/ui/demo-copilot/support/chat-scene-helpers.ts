// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Scene-only helpers of the real-Copilot demo scenes E2 and E9 (task 1.7): the
// shared start-up, a real hover over a workbench element, and a pointer that
// glides to a button inside an MCP App view in the chat. The release suite's
// ChatViews scroll a view to the top of the chat on every enter; a scene
// would show the list jumping, so this enters the overlay without scrolling.
// TDD exception: wdio glue over a real VS Code and Copilot; the decisions it
// calls (sendToAgent's guards, overlayOver, glidePath) are unit-tested.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { browser } from "@wdio/globals";
import { glidePath, targetPoint, type Point } from "../../../../scripts/demo/pointer-target.mts";
import { POINTER_OVERLAY_SCRIPT } from "../../../../scripts/demo/pointer-overlay.mts";
import { COPILOT_E2E_AGENT } from "../../copilot-e2e/support/copilot-e2e-settings.mts";
import { ChatView, ChatViews } from "../../copilot-e2e/support/chat-view.js";
import { MODEL, waitForCopilot } from "../../copilot-e2e/support/copilot-chat.js";
import { overlayOver, type Rect } from "../../copilot-e2e/support/view-overlay.mts";
import { skipTest } from "../../copilot-e2e/support/run-log.mts";
import { mastersDir } from "../../demo/support/demo-launch.mts";
import { wdioVscodeHost as host } from "../../support/vscode-host.js";

const GLIDE_STEPS = 25;
const GLIDE_FRAME_MS = 20;
const CLICK_PAUSE_MS = 150;
const MARK = "data-demo-target";

// What both scenes do before the recording starts: the extension up, built-in
// Copilot Chat on, Copilot ready (skips the test, recording nothing, when it
// isn't).
export async function prepareCopilotScene(context: Mocha.Context): Promise<void> {
  await host.waitForExtension();
  await host.command("workbench.extensions.action.enableAll");
  // The profile copy shows "You have Docker installed ... recommended extensions" a while after start-up,
  // over the chat input; the recommendations are off for the recording.
  await host.setSetting("extensions.ignoreRecommendations", true);
  const readiness = await waitForCopilot();
  if (readiness.status === "gave-up") skipTest(context, readiness.reason);
}

// Opens a chat in the test-only agent with `prompt` typed in the input and
// NOT sent, so a viewer sees the prompt before it goes. sendToAgent repeats
// this on a fresh chat and then sends, within the AI Credits cap.
export async function stageChatPrompt(prompt: string): Promise<void> {
  await host.command("workbench.action.chat.open", { mode: COPILOT_E2E_AGENT, modelSelector: { vendor: "copilot", id: MODEL }, query: prompt, isPartialQuery: true });
  await browser.waitUntil(async () => (await browser.$$(".interactive-input-part").length) > 0, { timeout: 30_000, timeoutMsg: "the chat input did not appear" });
}

// Dismisses what has popped up since (a toast mid-recording hides the chat input).
export async function clearToasts(): Promise<void> {
  await host.command("notifications.clearAll").catch(() => undefined);
}

// Drags the sash on the chat's side bar so the bar is about `target` px wide (the chat opens about 300 px
// wide, too narrow for the answer and the MCP App views), as a user drags it. Best effort: a miss leaves
// the default width and the scene goes on.
export async function widenChat(target: number): Promise<void> {
  try {
    const width = await browser.execute(() => {
      document.querySelectorAll("[data-demo-sash]").forEach((el) => el.removeAttribute("data-demo-sash"));
      const bar = document.querySelector(".part.auxiliarybar");
      if (!bar) return 0;
      const box = bar.getBoundingClientRect();
      const sash = Array.from(document.querySelectorAll(".monaco-sash.vertical")).find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.height > 100 && Math.abs(rect.left + rect.width / 2 - box.left) <= 6;
      });
      sash?.setAttribute("data-demo-sash", "");
      return sash ? box.width : 0;
    });
    if (width === 0 || width >= target) return;
    // Dragging left widens the side bar.
    await browser
      .action("pointer")
      .move({ origin: (await browser.$("[data-demo-sash]")) as never })
      .down()
      .move({ origin: "pointer", x: width - target, y: 0, duration: 400 })
      .up()
      .perform();
    await browser.pause(500);
  } catch (error) {
    console.log(`[demo] could not widen the chat: ${String(error)}`);
  }
}

// Saves a still next to the masters (task 1.8 turns these into docs images).
export async function saveStill(name: string): Promise<void> {
  mkdirSync(mastersDir(), { recursive: true });
  await browser.saveScreenshot(path.join(mastersDir(), name));
}

// Marks the first element of `selector` whose text contains `needle` (whitespace ignored), so a
// scene can reach it with markedElement(); returns whether there was one.
export async function markElement(selector: string, needle: string): Promise<boolean> {
  return browser.execute(
    (css: string, text: string, mark: string) => {
      document.querySelectorAll(`[${mark}]`).forEach((element) => element.removeAttribute(mark));
      const squash = (value: string) => value.replace(/\s+/g, "");
      const found = Array.from(document.querySelectorAll<HTMLElement>(css)).find((element) => squash(element.innerText).includes(squash(text)));
      found?.setAttribute(mark, "");
      return found !== undefined;
    },
    selector,
    needle,
    MARK,
  );
}

// A resolved element, the type DemoDriver.click and pointerTo take.
export function find(selector: string): Promise<WebdriverIO.Element> {
  return browser.$(selector).getElement();
}

export function markedElement(): Promise<WebdriverIO.Element> {
  return find(`[${MARK}]`);
}

// A real mouse move onto the element, so VS Code draws its hover (tooltip); resolves once one shows
// or `waitMs` passes (a scene never fails for a missing tooltip: the end-state assertion decides that).
export async function hoverForTooltip(element: WebdriverIO.Element, waitMs = 4_000): Promise<boolean> {
  await element.moveTo();
  return browser
    .waitUntil(async () => browser.execute(() => Array.from(document.querySelectorAll<HTMLElement>(".monaco-hover")).some((hover) => hover.offsetHeight > 0 && !hover.classList.contains("hidden"))), {
      timeout: waitMs,
      interval: 250,
    })
    .then(
      () => true,
      () => false,
    );
}

interface Geometry {
  placeholders: Rect[];
  overlays: { id: string; rect: Rect }[];
  list: Rect | null;
}

const GEOMETRY_SCRIPT = `(() => {
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  const list = document.querySelector(".interactive-list");
  return {
    placeholders: [...document.querySelectorAll(".mcp-app-part .mcp-app-webview")].map(rect),
    overlays: [...document.querySelectorAll(".webview-overlay-content")].filter((o) => getComputedStyle(o).visibility !== "hidden" && getComputedStyle(o).display !== "none").map((o) => ({ id: o.id, rect: rect(o.querySelector("iframe") || o) })),
    list: list ? rect(list) : null,
  };
})()`;

// The accessible name of a button, as ChatView.click finds it.
const BUTTON_RECT_SCRIPT = `(name) => {
  const label = (el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
  const button = [...document.querySelectorAll("button")].find((el) => label(el) === name);
  if (!button) return null;
  const r = button.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}`;

type PointerApi = { moveTo(x: number, y: number): void; ripple(): void };

// The chat's MCP App views for a scene: scroll once (show), then enter, read and click without
// moving the list, with the drawn pointer gliding to each button first.
export class DemoChatViews {
  readonly views = new ChatViews();

  private async geometry(): Promise<Geometry> {
    await browser.switchFrame(null);
    return (await browser.execute(`return ${GEOMETRY_SCRIPT}`)) as Geometry;
  }

  private async overlayId(index: number): Promise<string> {
    const { placeholders, overlays } = await this.geometry();
    const placeholder = placeholders[index];
    const id = placeholder ? overlayOver(placeholder, overlays) : undefined;
    if (id === undefined) throw new Error(`No webview lies over view ${index + 1}`);
    return id;
  }

  private async enterOverlay(id: string): Promise<ChatView> {
    await browser.switchFrame(null);
    await browser.switchFrame(await browser.$(`.webview-overlay-content[id="${id}"] iframe`));
    const active = await browser.$("#active-frame");
    await active.waitForExist({ timeout: 30_000 });
    await browser.switchFrame(active);
    return new ChatView();
  }

  // Brings the view to the top of the chat (once, at the start of a scene's view steps).
  async show(index: number): Promise<void> {
    await this.views.scrollTo(index);
  }

  async inView<T>(index: number, act: (view: ChatView) => Promise<T>): Promise<T> {
    const view = await this.enterOverlay(await this.overlayId(index));
    try {
      return await act(view);
    } finally {
      await browser.switchFrame(null);
    }
  }

  // Where the button is on screen (top-document coordinates) and the chat list's rect.
  private async locate(index: number, name: string): Promise<{ point: Point; list: Rect }> {
    const id = await this.overlayId(index);
    await this.enterOverlay(id);
    const inner = (await browser.execute(`return (${BUTTON_RECT_SCRIPT})(${JSON.stringify(name)})`)) as Rect | null;
    await browser.switchFrame(null);
    if (inner === null) throw new Error(`The view has no button "${name}"`);
    const overlay = await browser.execute((overlayId: string) => {
      const r = document.querySelector(`.webview-overlay-content[id="${overlayId}"] iframe`)!.getBoundingClientRect();
      return { x: r.x, y: r.y };
    }, id);
    await browser.switchFrame(await browser.$(`.webview-overlay-content[id="${id}"] iframe`));
    const active = await browser.execute(() => {
      const r = document.getElementById("active-frame")!.getBoundingClientRect();
      return { x: r.x, y: r.y };
    });
    await browser.switchFrame(null);
    const { list } = await this.geometry();
    if (list === null) throw new Error("The chat has no list");
    return { point: targetPoint(inner, [overlay, active]), list };
  }

  // Wheel-scrolls the chat list (over its margin beside the views) until the button is inside it.
  private async bringIntoList(index: number, name: string): Promise<Point> {
    let located = await this.locate(index, name);
    for (let attempt = 0; attempt < 6; attempt++) {
      const { point, list } = located;
      const margin = 40;
      const above = list.y + margin - point.y;
      const below = point.y - (list.y + list.height - margin);
      if (above <= 0 && below <= 0) break;
      const deltaY = Math.round(above > 0 ? -above - 60 : below + 60);
      await browser.action("wheel").scroll({ x: Math.round(list.x + 6), y: Math.round(list.y + list.height / 2), deltaY, duration: 50 }).perform();
      await browser.pause(400);
      located = await this.locate(index, name);
    }
    return located.point;
  }

  // The drawn pointer glides to the button and ripples, then the button is pressed. The glide is
  // cosmetic: if it fails the press still happens (a paid take must not be lost to the pointer).
  async click(index: number, name: string): Promise<void> {
    try {
      await this.glide(await this.bringIntoList(index, name));
    } catch (error) {
      console.log(`[demo] the pointer could not reach "${name}": ${String(error)}`);
    } finally {
      await browser.switchFrame(null);
    }
    await this.inView(index, (view) => view.click(name));
  }

  private async glide(to: Point): Promise<void> {
    await browser.switchFrame(null);
    await browser.execute(POINTER_OVERLAY_SCRIPT);
    const from = await browser.execute((): Point => {
      const pointer = document.getElementById("__demo-pointer");
      return { x: parseFloat(pointer?.style.left ?? "") || 600, y: parseFloat(pointer?.style.top ?? "") || 400 };
    });
    for (const step of glidePath(from, to, GLIDE_STEPS)) {
      await browser.execute((x: number, y: number) => (window as unknown as { __demoPointer: PointerApi }).__demoPointer.moveTo(x, y), step.x, step.y);
      await browser.pause(GLIDE_FRAME_MS);
    }
    await browser.execute(() => (window as unknown as { __demoPointer: PointerApi }).__demoPointer.ripple());
    await browser.pause(CLICK_PAUSE_MS);
  }
}
