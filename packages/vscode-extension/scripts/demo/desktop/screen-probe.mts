// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { existsSync } from "node:fs";
import path from "node:path";
import { ffmpegBinary, FRAME } from "../ffmpeg-args.mts";
import type { Match } from "./click-point.mts";
import { nodeRun, type RunCommand } from "./xdotool.mts";

export const TEMPLATE_DIR = path.join(import.meta.dirname, "templates");
const MATCH_PY = path.join(import.meta.dirname, "match.py");
// Two probes in one poll (permission prompt, then the wanted template) share a frame this fresh.
const FRAME_REUSE_MS = 150;

export function templatePath(name: string): string {
  return path.join(TEMPLATE_DIR, `${name}.png`);
}

export function missingTemplates(names: string[], exists: (file: string) => boolean = existsSync): string[] {
  return names.filter((name) => !exists(templatePath(name)));
}

// Grabs one frame of the display with x11grab and matches templates against it with OpenCV.
export class ScreenProbe {
  private frameAt = 0;

  constructor(
    private readonly display: string,
    private readonly frameFile: string,
    private readonly run: RunCommand = nodeRun,
    private readonly now: () => number = Date.now,
  ) {}

  private async grab(): Promise<void> {
    if (this.now() - this.frameAt < FRAME_REUSE_MS) return;
    await this.run(
      ffmpegBinary(process.env),
      ["-loglevel", "error", "-y", "-f", "x11grab", "-video_size", `${FRAME.width}x${FRAME.height}`, "-i", this.display, "-frames:v", "1", this.frameFile],
      {},
    );
    this.frameAt = this.now();
  }

  async scores(names: string[], minX?: number): Promise<Record<string, Match>> {
    await this.grab();
    const region = minX === undefined ? [] : ["--min-x", String(minX)];
    const out = await this.run("python3", ["-I", MATCH_PY, ...region, this.frameFile, ...names.map(templatePath)], {});
    return JSON.parse(out) as Record<string, Match>;
  }

  async find(name: string, minX?: number): Promise<Match | undefined> {
    return (await this.scores([name], minX))[name];
  }
}
