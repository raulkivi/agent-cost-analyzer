// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { execFile } from "node:child_process";
import type { Point } from "./click-point.mts";
import { promptKeystrokes } from "./prompt-keystrokes.mts";

export type RunCommand = (command: string, args: string[], env: Record<string, string | undefined>) => Promise<string>;

export const nodeRun: RunCommand = (command, args, env) =>
  new Promise((resolve, reject) => {
    const merged: Record<string, string | undefined> = { ...process.env, ...env };
    for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
    execFile(command, args, { env: merged }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command} ${args.join(" ")} failed: ${stderr.trim() || error.message}`));
      else resolve(stdout);
    });
  });

// Keyboard and mouse for one X display. The process runner is injected so tests need no X server.
export class Xdotool {
  constructor(
    private readonly display: string,
    private readonly run: RunCommand = nodeRun,
  ) {}

  private xdo(args: string[]): Promise<string> {
    return this.run("xdotool", args, { DISPLAY: this.display, WAYLAND_DISPLAY: undefined });
  }

  async click(point: Point): Promise<void> {
    await this.xdo(["mousemove", String(point.x), String(point.y), "click", "1"]);
  }

  // Button 5 is wheel-down; X has no scroll-by-pixels, so the caller counts notches.
  async scrollDown(point: Point, clicks: number): Promise<void> {
    await this.xdo(["mousemove", String(point.x), String(point.y), "click", "--repeat", String(clicks), "--delay", "60", "5"]);
  }

  async key(chord: string): Promise<void> {
    await this.xdo(["key", "--clearmodifiers", chord]);
  }

  async type(text: string, delayMs: number): Promise<void> {
    await this.xdo(promptKeystrokes(text, delayMs));
  }

  async fitWindow(id: string, frame: { width: number; height: number }): Promise<void> {
    await this.xdo(["windowmove", id, "0", "0", "windowsize", id, String(frame.width), String(frame.height)]);
  }

  async findWindow(windowClass: string): Promise<string | undefined> {
    // xdotool exits non-zero when nothing matches; that just means "not there yet".
    const out = await this.xdo(["search", "--onlyvisible", "--class", windowClass]).catch(() => "");
    return out.split("\n").find((line) => line.trim() !== "")?.trim();
  }
}
