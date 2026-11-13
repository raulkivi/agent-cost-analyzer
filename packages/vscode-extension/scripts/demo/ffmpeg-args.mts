// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// ffmpeg argument lists for the demo recordings. Pure: callers spawn the binary.

// 1200x800 is what fits Xvfb with VS Code at 1x (spike 1.0).
export const FRAME = { width: 1200, height: 800, fps: 30 } as const;

export const GIF_DEFAULTS = { fps: 12, width: 1200, maxBytes: 4 * 1024 * 1024, maxSeconds: 20 } as const;

// The PATH ffprobe is a firejail wrapper that can't read our files (spike 1.0), so default to the real binaries.
export function ffmpegBinary(env: Record<string, string | undefined>): string {
  return env.AICA_FFMPEG ?? "/usr/bin/ffmpeg";
}

export function ffprobeBinary(env: Record<string, string | undefined>): string {
  return env.AICA_FFPROBE ?? "/usr/bin/ffprobe";
}

const H264 = ["-c:v", "libx264"];
const COMMON_OUT = ["-crf", "18", "-pix_fmt", "yuv420p"];

export function recordArgs(o: { display: string; width: number; height: number; fps: number; out: string }): string[] {
  // x11grab wants "<display>.<screen>"; don't double a screen the caller gave.
  const input = /\.\d+$/.test(o.display) ? o.display : `${o.display}.0`;
  return [
    "-y", "-loglevel", "error",
    "-f", "x11grab",
    "-video_size", `${o.width}x${o.height}`,
    "-framerate", String(o.fps),
    // wdio never moves the X pointer; the demo draws its own.
    "-draw_mouse", "0",
    "-i", `${input}+0,0`,
    ...H264, "-preset", "ultrafast", ...COMMON_OUT,
    o.out,
  ];
}

export function trimArgs(o: { input: string; startSec: number; durationSec: number; out: string }): string[] {
  // -ss before -i seeks fast; re-encoding keeps the cut frame-accurate.
  return [
    "-y", "-loglevel", "error",
    "-ss", String(o.startSec),
    "-i", o.input,
    "-t", String(o.durationSec),
    ...H264, "-preset", "veryfast", ...COMMON_OUT,
    o.out,
  ];
}

export function gifArgs(o: { input: string; fps: number; width: number; out: string }): string[] {
  const filter =
    `fps=${o.fps},scale=${o.width}:-1:flags=lanczos,split[a][b];` +
    "[a]palettegen=stats_mode=diff[p];" +
    "[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle";
  return ["-y", "-loglevel", "error", "-i", o.input, "-vf", filter, "-loop", "0", o.out];
}
