// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Records the X display into an MP4 master with ffmpeg's x11grab. The scene
// starts it, awaits `ready()` (a bad display exits ffmpeg within a moment, and a
// scene must not run unrecorded), and ends it with `stop()` or, on failure, `discard()`.
import { spawn as nodeSpawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { ffmpegBinary, recordArgs } from "./ffmpeg-args.mts";

export interface RecorderOptions {
  display: string;
  width: number;
  height: number;
  fps: number;
  out: string;
}

export interface Recorder {
  // Resolves once ffmpeg has survived its first moments; rejects with its stderr if it exited.
  ready(): Promise<void>;
  // Finishes the file (ffmpeg writes the MP4 index on `q`); rejects if ffmpeg failed or hung.
  stop(): Promise<void>;
  // stop() without caring how it went, then deletes the file.
  discard(): Promise<void>;
}

export interface RecorderTimings {
  // ffmpeg exits at once on an unreachable display; this long without an exit counts as started.
  earlyExitWindowMs?: number;
  // After `q`: this long to SIGINT, and this long more to SIGKILL.
  stopTimeoutMs?: number;
}

// The slice of ChildProcess the recorder uses, so a test can fake it.
interface FfmpegProcess {
  stdin: { write(chunk: string): unknown; end(): unknown };
  stderr: { on(event: "data", listener: (chunk: Buffer) => void): unknown };
  on(event: "exit", listener: (code: number | null, signal: string | null) => void): unknown;
  kill(signal: NodeJS.Signals): unknown;
}

export type RecorderSpawn = (command: string, args: string[], options: { stdio: ["pipe", "ignore", "pipe"] }) => FfmpegProcess;

const STDERR_TAIL_CHARS = 2000;

export function startRecorder(o: RecorderOptions, spawn: RecorderSpawn = nodeSpawn as never, timings: RecorderTimings = {}): Recorder {
  const earlyExitWindowMs = timings.earlyExitWindowMs ?? 500;
  const stopTimeoutMs = timings.stopTimeoutMs ?? 15_000;
  mkdirSync(path.dirname(o.out), { recursive: true });
  const child = spawn(ffmpegBinary(process.env), recordArgs(o), { stdio: ["pipe", "ignore", "pipe"] });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL_CHARS);
  });
  const tail = () => stderr.trim() || "(no output)";

  let exited: { code: number | null; signal: string | null } | undefined;
  const waiters: (() => void)[] = [];
  child.on("exit", (code, signal) => {
    exited = { code, signal };
    for (const wake of waiters) wake();
  });
  const failure = (what: string) => new Error(`ffmpeg ${what} (exit ${exited?.code ?? exited?.signal}): ${tail()}`);

  const early = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, earlyExitWindowMs);
    waiters.push(() => {
      clearTimeout(timer);
      reject(failure("exited right after starting"));
    });
  });
  // A scene that never calls ready() must not leave an unhandled rejection behind.
  early.catch(() => undefined);

  let stopping: Promise<void> | undefined;
  function stop(): Promise<void> {
    stopping ??= new Promise<void>((resolve, reject) => {
      if (exited !== undefined) {
        if (exited.code === 0) resolve();
        else reject(failure("had already stopped"));
        return;
      }
      const timers: NodeJS.Timeout[] = [];
      waiters.push(() => {
        timers.forEach(clearTimeout);
        if (exited?.code === 0) resolve();
        else reject(failure("failed while stopping"));
      });
      try {
        child.stdin.write("q");
        child.stdin.end();
      } catch {
        // The exit handler reports what happened.
      }
      timers.push(
        setTimeout(() => {
          child.kill("SIGINT");
          timers.push(
            setTimeout(() => {
              child.kill("SIGKILL");
              reject(failure("did not stop after q and SIGINT; killed"));
            }, stopTimeoutMs),
          );
        }, stopTimeoutMs),
      );
    });
    return stopping;
  }

  return {
    ready: () => early,
    stop,
    async discard() {
      await stop().catch(() => undefined);
      await rm(o.out, { force: true });
    },
  };
}
