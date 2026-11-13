// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Stills from the demo scenes (task 1.8): a screenshot of a settled frame, written to
// <masters>/stills/<name>.png. The main session copies approved stills into docs (task 1.10).
// Call from the workbench (top) document, not from inside a webview frame.
// TDD exception: wdio glue; the path rule it uses (stillPath) is unit-tested.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { browser } from "@wdio/globals";
import { stillPath } from "./demo-launch.mts";

export interface StillOptions {
  // Keep the real pointer where it is, for a still whose subject is a hover (a tooltip).
  keepHover?: boolean;
}

const PARK_POINT = { x: 1190, y: 790 };
const SETTLE_MS = 400;

// The drawn demo pointer (an overlay in the workbench document) never belongs in a still.
async function setPointerVisible(visible: boolean): Promise<void> {
  await browser.execute((show: boolean) => {
    const pointer = document.getElementById("__demo-pointer");
    if (pointer) pointer.style.visibility = show ? "visible" : "hidden";
  }, visible);
}

export async function saveStill(name: string, options: StillOptions = {}): Promise<string> {
  const file = stillPath(name);
  mkdirSync(path.dirname(file), { recursive: true });
  await setPointerVisible(false);
  try {
    if (options.keepHover !== true) await browser.action("pointer").move({ x: PARK_POINT.x, y: PARK_POINT.y }).perform();
    await browser.pause(SETTLE_MS);
    await browser.saveScreenshot(file);
  } finally {
    await setPointerVisible(true);
  }
  return file;
}
