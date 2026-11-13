// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { FRAME, GIF_DEFAULTS, ffmpegBinary, ffprobeBinary, gifArgs, recordArgs, trimArgs } from "./ffmpeg-args.mts";

describe("ffmpeg arguments", () => {
  it("fixes the frame and GIF defaults from spike 1.0", () => {
    expect(FRAME).toEqual({ width: 1200, height: 800, fps: 30 });
    expect(GIF_DEFAULTS).toEqual({ fps: 12, width: 1200, maxBytes: 4 * 1024 * 1024, maxSeconds: 20 });
  });

  it("records an x11grab display without the mouse pointer", () => {
    expect(recordArgs({ display: ":99", width: 1200, height: 800, fps: 30, out: "a.mp4" })).toEqual([
      "-y", "-loglevel", "error", "-f", "x11grab", "-video_size", "1200x800", "-framerate", "30",
      "-draw_mouse", "0", "-i", ":99.0+0,0", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
      "-pix_fmt", "yuv420p", "a.mp4",
    ]);
  });

  it("keeps a screen number already in the display", () => {
    const args = recordArgs({ display: ":99.1", width: 10, height: 20, fps: 5, out: "o.mp4" });
    expect(args).toContain(":99.1+0,0");
  });

  it("trims by re-encoding, with -ss before -i", () => {
    const args = trimArgs({ input: "in.mp4", startSec: 1.5, durationSec: 8, out: "out.mp4" });
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(args).toEqual([
      "-y", "-loglevel", "error", "-ss", "1.5", "-i", "in.mp4", "-t", "8",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "out.mp4",
    ]);
  });

  it("builds the GIF filter with fps and width substituted", () => {
    const args = gifArgs({ input: "in.mp4", fps: 10, width: 800, out: "o.gif" });
    expect(args).toContain(
      "fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
    );
    expect(args[args.length - 1]).toBe("o.gif");
    expect(args[args.indexOf("-i") + 1]).toBe("in.mp4");
  });

  it("returns no binary name in any argument list", () => {
    expect(gifArgs({ input: "i", fps: 12, width: 1200, out: "o" })[0]).not.toMatch(/ffmpeg/);
  });

  it("resolves binaries from the environment, defaulting to /usr/bin (PATH ffprobe is a firejail wrapper)", () => {
    expect(ffmpegBinary({})).toBe("/usr/bin/ffmpeg");
    expect(ffprobeBinary({})).toBe("/usr/bin/ffprobe");
    expect(ffmpegBinary({ AICA_FFMPEG: "/x/ff" })).toBe("/x/ff");
    expect(ffprobeBinary({ AICA_FFPROBE: "/x/fp" })).toBe("/x/fp");
  });
});
