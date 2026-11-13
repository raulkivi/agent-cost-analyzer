// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// What the demo recording configs share (wdio.demo.conf.mts, wdio.demo-copilot.conf.mts;
// docs/plans/docs-refresh-and-demo-recordings.md §5): the user settings that keep the
// frame free of first-run clutter, the frame check, and the masters directory.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FRAME } from "../../../../scripts/demo/ffmpeg-args.mts";

// What a viewer should see: a dark theme at 1x, the font installed with the repo's
// docs tooling, no Welcome tab, no update or telemetry prompts, no tips.
export const DEMO_USER_SETTINGS: Record<string, unknown> = {
  "workbench.colorTheme": "Default Dark Modern",
  "window.zoomLevel": 0,
  // A fixed title, so neither a path nor "[Extension Development Host]" shows in the title bar.
  "window.title": "AI Credits Analyzer",
  "editor.fontFamily": "DejaVu Sans Mono",
  "workbench.startupEditor": "none",
  "workbench.tips.enabled": false,
  // No "[Extension Development Host] Search" box in the title bar. With it off the title bar
  // shows the window title, so that is a fixed string (the default template adds the
  // "[Extension Development Host]" prefix). The Accounts avatar is not a setting in VS Code
  // 1.146 (a storage toggle); runDemoScene hides it through the activity bar's menu.
  "window.commandCenter": false,
  "update.mode": "none",
  "extensions.autoCheckUpdates": false,
  "telemetry.telemetryLevel": "off",
};

// X11 only, so a Wayland desktop's compositor doesn't take the window (spike 1.0).
export const DEMO_VSCODE_ARGS: Record<string, string | boolean> = {
  "ozone-platform": "x11",
  "disable-renderer-backgrounding": true,
  "disable-backgrounding-occluded-windows": true,
  "disable-features": "CalculateNativeWinOcclusion",
};

// Spike 1.0: VS Code opens at a fixed 1200x800 without a window manager, so only an
// Xvfb screen of exactly that size lets the window fill the frame.
const FRAME_TOLERANCE_PX = 4;

export interface WindowBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function frameProblem(window: WindowBox): string | undefined {
  const near = (actual: number, wanted: number) => Math.abs(actual - wanted) <= FRAME_TOLERANCE_PX;
  if (near(window.width, FRAME.width) && near(window.height, FRAME.height) && near(window.x, 0) && near(window.y, 0)) return undefined;
  return `The VS Code window is ${window.width}x${window.height} at ${window.x},${window.y}, not the ${FRAME.width}x${FRAME.height} frame at 0,0: run it under \`xvfb-run -s "-screen 0 ${FRAME.width}x${FRAME.height}x24"\` (npm run demo:record does), and with no saved window position`;
}

// What the workbench reports, for assertWindowFillsFrame.
export function readWindowBox(): WindowBox {
  return { x: window.screenX, y: window.screenY, width: window.innerWidth, height: window.innerHeight };
}

// Fails the run before a scene records a window that doesn't fill the frame.
export async function assertWindowFillsFrame(read: () => Promise<WindowBox>): Promise<void> {
  const problem = frameProblem(await read());
  if (problem !== undefined) throw new Error(problem);
}

// The signed-in profile remembers where its window was (x 10, y 10, bigger than the
// frame), and VS Code reopens it there: shifted and cropped in the recording. Drop the
// saved window and splash state from the profile copy; nothing else in the file is touched.
export function dropSavedWindowState(storageJsonPath: string): void {
  if (!existsSync(storageJsonPath)) return;
  const storage = JSON.parse(readFileSync(storageJsonPath, "utf-8")) as Record<string, unknown>;
  delete storage.windowsState;
  delete storage.windowSplash;
  writeFileSync(storageJsonPath, JSON.stringify(storage, null, 2));
}

// <repo root>/demo-masters, git-ignored. This file is packages/vscode-extension/test/ui/demo/support.
export function mastersDir(env: Record<string, string | undefined> = process.env): string {
  return env.AICA_DEMO_MASTERS ?? path.resolve(import.meta.dirname, "../../../../../../demo-masters");
}

// Where a scene's still lands: <masters>/stills/<name>.png (never straight into docs).
export function stillPath(name: string, env: Record<string, string | undefined> = process.env): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`Invalid still name "${name}": use lower-case letters, digits and dashes, no extension`);
  return path.join(mastersDir(env), "stills", `${name}.png`);
}
