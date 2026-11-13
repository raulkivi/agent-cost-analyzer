// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { GIF_DEFAULTS, gifArgs, trimArgs } from "./ffmpeg-args.mts";
import { gifVerdict, makeGif, parseArgs, type MakeGifDeps } from "./make-gif.mts";

describe("parseArgs", () => {
  it("takes the input alone", () => {
    expect(parseArgs(["e0-test.mp4"])).toEqual({ input: "e0-test.mp4" });
  });

  it("reads --trim as start and duration, and --out-dir", () => {
    expect(parseArgs(["e5.webm", "--trim", "1.5,8", "--out-dir", "/o"])).toEqual({
      input: "e5.webm",
      trim: { startSec: 1.5, durationSec: 8 },
      outDir: "/o",
    });
  });

  it.each([
    ["one number", ["a.mp4", "--trim", "1"]],
    ["three numbers", ["a.mp4", "--trim", "1,2,3"]],
    ["a negative start", ["a.mp4", "--trim", "-1,2"]],
    ["a zero duration", ["a.mp4", "--trim", "1,0"]],
    ["a non-number", ["a.mp4", "--trim", "a,2"]],
    ["an empty part", ["a.mp4", "--trim", "1,"]],
  ])("rejects --trim with %s", (_label, argv) => {
    expect(() => parseArgs(argv)).toThrow(/--trim/);
  });

  it("rejects an unknown flag", () => {
    expect(() => parseArgs(["a.mp4", "--fps", "5"])).toThrow(/unknown option --fps/);
  });

  it("rejects a missing input", () => {
    expect(() => parseArgs([])).toThrow(/input/);
    expect(() => parseArgs(["--out-dir", "/o"])).toThrow(/input/);
  });

  it("rejects two inputs and a flag without its value", () => {
    expect(() => parseArgs(["a.mp4", "b.mp4"])).toThrow(/one input/);
    expect(() => parseArgs(["a.mp4", "--out-dir"])).toThrow(/--out-dir/);
  });
});

describe("gifVerdict", () => {
  it("is ok at exactly the limits", () => {
    expect(gifVerdict({ bytes: GIF_DEFAULTS.maxBytes, seconds: GIF_DEFAULTS.maxSeconds })).toBe("ok");
  });

  it("is too-long just over the duration limit", () => {
    expect(gifVerdict({ bytes: 1, seconds: GIF_DEFAULTS.maxSeconds + 0.001 })).toBe("too-long");
  });

  it("is too-big just over the size limit", () => {
    expect(gifVerdict({ bytes: GIF_DEFAULTS.maxBytes + 1, seconds: 1 })).toBe("too-big");
  });

  it("checks the duration alone before the GIF exists", () => {
    expect(gifVerdict({ seconds: 5 })).toBe("ok");
    expect(gifVerdict({ seconds: 25 })).toBe("too-long");
  });

  it("reports too-long first when both limits are exceeded", () => {
    expect(gifVerdict({ bytes: GIF_DEFAULTS.maxBytes + 1, seconds: 25 })).toBe("too-long");
  });
});

interface Run {
  bin: string;
  args: string[];
}

function fakeDeps(opts: { duration?: string; ffprobeCode?: number; gifBytes?: number } = {}) {
  const runs: Run[] = [];
  const removed: string[] = [];
  const dirs: string[] = [];
  const deps: MakeGifDeps = {
    env: { AICA_FFMPEG: "/bin/ff", AICA_FFPROBE: "/bin/fp" },
    run: async (bin, args) => {
      runs.push({ bin, args });
      if (bin === "/bin/fp") {
        return { code: opts.ffprobeCode ?? 0, stdout: `${opts.duration ?? "3.000000"}\n`, stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
    statSize: async () => opts.gifBytes ?? 1000,
    remove: async (path) => {
      removed.push(path);
    },
    mkdir: async (dir) => {
      dirs.push(dir);
    },
    tempPath: (name) => `/tmp/aica/${name}`,
  };
  return { deps, runs, removed, dirs };
}

const PROBE = ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", "/in/e0-test.mp4"];

describe("makeGif", () => {
  it("probes the duration with ffprobe, then converts with ffmpeg", async () => {
    const { deps, runs, dirs } = fakeDeps();
    const result = await makeGif({ input: "/in/e0-test.mp4", outDir: "/out" }, deps);

    expect(runs).toEqual([
      { bin: "/bin/fp", args: PROBE },
      {
        bin: "/bin/ff",
        args: gifArgs({ input: "/in/e0-test.mp4", fps: GIF_DEFAULTS.fps, width: GIF_DEFAULTS.width, out: "/out/e0-test.gif" }),
      },
    ]);
    expect(dirs).toEqual(["/out"]);
    expect(result).toEqual({ gifPath: "/out/e0-test.gif", bytes: 1000, seconds: 3 });
  });

  it("trims into a temp file first when --trim is given, then converts that file", async () => {
    const { deps, runs, removed } = fakeDeps();
    const result = await makeGif(
      { input: "/in/e0-test.mp4", outDir: "/out", trim: { startSec: 1, durationSec: 2 } },
      deps,
    );

    expect(runs[1]).toEqual({
      bin: "/bin/ff",
      args: trimArgs({ input: "/in/e0-test.mp4", startSec: 1, durationSec: 2, out: "/tmp/aica/e0-test-trim.mp4" }),
    });
    expect(runs[2].args).toEqual(
      gifArgs({ input: "/tmp/aica/e0-test-trim.mp4", fps: GIF_DEFAULTS.fps, width: GIF_DEFAULTS.width, out: "/out/e0-test.gif" }),
    );
    expect(removed).toEqual(["/tmp/aica/e0-test-trim.mp4"]);
    expect(result.seconds).toBe(2);
  });

  it("clamps the trimmed length to what the clip has left", async () => {
    const { deps } = fakeDeps({ duration: "2" });
    const result = await makeGif(
      { input: "/in/e0-test.mp4", outDir: "/out", trim: { startSec: 1, durationSec: 5 } },
      deps,
    );
    expect(result.seconds).toBe(1);
  });

  it("deletes the GIF and fails when it is over the size limit", async () => {
    const { deps, removed } = fakeDeps({ gifBytes: GIF_DEFAULTS.maxBytes + 1 });
    await expect(makeGif({ input: "/in/e0-test.mp4", outDir: "/out" }, deps)).rejects.toThrow(
      /GIF is 4\.00 MB; the limit is 4\.00 MB.*--trim.*lower the fps.*MP4/s,
    );
    expect(removed).toEqual(["/out/e0-test.gif"]);
  });

  it("refuses an input longer than the limit before running ffmpeg", async () => {
    const { deps, runs } = fakeDeps({ duration: "25" });
    await expect(makeGif({ input: "/in/e0-test.mp4", outDir: "/out" }, deps)).rejects.toThrow(/25\.0 s.*--trim/);
    expect(runs).toHaveLength(1);
    expect(runs[0].bin).toBe("/bin/fp");
  });

  it("accepts a long input once --trim brings it under the limit", async () => {
    const { deps, runs } = fakeDeps({ duration: "25" });
    await makeGif({ input: "/in/e0-test.mp4", outDir: "/out", trim: { startSec: 0, durationSec: 10 } }, deps);
    expect(runs.some((run) => run.args.includes("/tmp/aica/e0-test-trim.mp4"))).toBe(true);
  });

  it("fails with ffprobe's name when the probe exits non-zero", async () => {
    const { deps, runs } = fakeDeps({ ffprobeCode: 1 });
    await expect(makeGif({ input: "/in/e0-test.mp4", outDir: "/out" }, deps)).rejects.toThrow(/ffprobe/);
    expect(runs).toHaveLength(1);
  });
});
