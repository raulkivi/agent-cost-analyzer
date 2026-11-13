// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// `npm run demo:gif -- <master.mp4|webm> [--trim <start>,<duration>] [--out-dir <dir>]`
// Turns a recorded master into a GIF under the README budget. The logic takes
// its processes and filesystem as injected deps so the tests run without ffmpeg.
import { spawn } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GIF_DEFAULTS, ffmpegBinary, ffprobeBinary, gifArgs, trimArgs } from "./ffmpeg-args.mts";

export interface Trim {
  startSec: number;
  durationSec: number;
}

export interface DemoGifArgs {
  input: string;
  trim?: Trim;
  outDir?: string;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface MakeGifDeps {
  env: Record<string, string | undefined>;
  run(bin: string, args: string[]): Promise<RunResult>;
  statSize(file: string): Promise<number>;
  remove(file: string): Promise<void>;
  mkdir(dir: string): Promise<void>;
  tempPath(name: string): string;
}

export interface MakeGifOptions {
  input: string;
  outDir: string;
  trim?: Trim;
}

export interface GifResult {
  gifPath: string;
  bytes: number;
  seconds: number;
}

export type GifVerdict = "ok" | "too-long" | "too-big";

// Plain non-negative decimals only: Number("") and Number(" ") would pass as 0.
const DECIMAL = /^\d+(\.\d+)?$/;

function parseTrim(value: string): Trim {
  const parts = value.split(",");
  if (parts.length !== 2 || !parts.every((part) => DECIMAL.test(part))) {
    throw new Error(`--trim takes <start>,<duration> in seconds, e.g. --trim 1.5,8 (got "${value}")`);
  }
  const durationSec = Number(parts[1]);
  if (durationSec <= 0) {
    throw new Error(`--trim duration must be above 0 (got "${value}")`);
  }
  return { startSec: Number(parts[0]), durationSec };
}

function valueAfter(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
}

export function parseArgs(argv: readonly string[]): DemoGifArgs {
  let input: string | undefined;
  let trim: Trim | undefined;
  let outDir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--trim") {
      trim = parseTrim(valueAfter(argv, i, arg));
      i++;
    } else if (arg === "--out-dir") {
      outDir = valueAfter(argv, i, arg);
      i++;
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option ${arg}`);
    } else if (input === undefined) {
      input = arg;
    } else {
      throw new Error(`expected one input, got a second one: ${arg}`);
    }
  }
  if (input === undefined) {
    throw new Error("missing input: pass a .mp4 or .webm master");
  }
  return { input, trim, outDir };
}

// Equal to a limit is still within budget. Duration comes first: a too-long
// clip is refused before ffmpeg runs, when no GIF exists yet to measure.
export function gifVerdict({ bytes, seconds }: { bytes?: number; seconds: number }): GifVerdict {
  if (seconds > GIF_DEFAULTS.maxSeconds) return "too-long";
  if (bytes !== undefined && bytes > GIF_DEFAULTS.maxBytes) return "too-big";
  return "ok";
}

const toMB = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(2);

function failureText(result: RunResult): string {
  return result.stderr.trim() || `exit ${result.code}`;
}

async function runOrThrow(deps: MakeGifDeps, bin: string, args: string[], label: string, input: string): Promise<void> {
  const result = await deps.run(bin, args);
  if (result.code !== 0) {
    throw new Error(`${label} failed on ${input}: ${failureText(result)}`);
  }
}

export async function makeGif(options: MakeGifOptions, deps: MakeGifDeps): Promise<GifResult> {
  const { input, outDir, trim } = options;
  const ffmpeg = ffmpegBinary(deps.env);

  const probe = await deps.run(ffprobeBinary(deps.env), [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", input,
  ]);
  if (probe.code !== 0) {
    throw new Error(`ffprobe failed on ${input}: ${failureText(probe)}`);
  }
  const clipSeconds = Number.parseFloat(probe.stdout);
  if (!Number.isFinite(clipSeconds)) {
    throw new Error(`ffprobe printed no duration for ${input}`);
  }

  const seconds = trim ? Math.min(trim.durationSec, clipSeconds - trim.startSec) : clipSeconds;
  if (seconds <= 0) {
    throw new Error(`--trim starts at ${trim?.startSec} s, past the end of ${input} (${clipSeconds.toFixed(1)} s)`);
  }
  if (gifVerdict({ seconds }) === "too-long") {
    throw new Error(
      `${input} is ${seconds.toFixed(1)} s; the GIF limit is ${GIF_DEFAULTS.maxSeconds} s. ` +
        `Trim it with --trim <start>,<duration>, e.g. --trim 0,${GIF_DEFAULTS.maxSeconds}.`,
    );
  }

  const name = path.basename(input, path.extname(input));
  const gifPath = path.join(outDir, `${name}.gif`);
  await deps.mkdir(outDir);

  let source = input;
  let trimmed: string | undefined;
  try {
    if (trim) {
      trimmed = deps.tempPath(`${name}-trim.mp4`);
      await runOrThrow(deps, ffmpeg, trimArgs({ input, startSec: trim.startSec, durationSec: trim.durationSec, out: trimmed }), "ffmpeg trim", input);
      source = trimmed;
    }
    await runOrThrow(deps, ffmpeg, gifArgs({ input: source, fps: GIF_DEFAULTS.fps, width: GIF_DEFAULTS.width, out: gifPath }), "ffmpeg", input);

    const bytes = await deps.statSize(gifPath);
    if (gifVerdict({ bytes, seconds }) === "too-big") {
      await deps.remove(gifPath);
      throw new Error(
        `GIF is ${toMB(bytes)} MB; the limit is ${toMB(GIF_DEFAULTS.maxBytes)} MB and the GIF was deleted. ` +
          `Options: --trim <start>,<duration> to shorten the clip, lower the fps (now ${GIF_DEFAULTS.fps}), ` +
          "or publish the MP4 only (plan §5).",
      );
    }
    return { gifPath, bytes, seconds };
  } finally {
    if (trimmed) await deps.remove(trimmed);
  }
}

// CLI wiring: the only part that touches the real processes and filesystem.
const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = path.resolve(here, "../../../../docs/images/demo");

function spawnRun(bin: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

const realDeps: MakeGifDeps = {
  env: process.env,
  run: spawnRun,
  statSize: async (file) => (await stat(file)).size,
  remove: (file) => rm(file, { force: true }),
  mkdir: async (dir) => {
    await mkdir(dir, { recursive: true });
  },
  tempPath: (name) => path.join(tmpdir(), `aica-demo-${process.pid}-${name}`),
};

// `npm run -w` runs in the package directory; INIT_CWD is where the user typed it.
const callerDir = process.env.INIT_CWD ?? process.cwd();

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const result = await makeGif(
    {
      input: path.resolve(callerDir, args.input),
      outDir: args.outDir === undefined ? DEFAULT_OUT_DIR : path.resolve(callerDir, args.outDir),
      trim: args.trim,
    },
    realDeps,
  );
  console.log(`${result.gifPath}  ${toMB(result.bytes)} MB  ${result.seconds.toFixed(1)} s`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`demo:gif: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
