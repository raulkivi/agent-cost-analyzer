// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordArgs } from "./ffmpeg-args.mts";
import { startRecorder, type RecorderSpawn } from "./recorder.mts";

class FakeFfmpeg extends EventEmitter {
  stdin = { writes: [] as string[], write: (s: string) => { this.stdin.writes.push(s); return true; }, end: () => undefined };
  stderr = new EventEmitter();
  kills: string[] = [];
  kill(signal: string): boolean {
    this.kills.push(signal);
    return true;
  }
  exit(code: number | null, signal: string | null = null): void {
    this.emit("exit", code, signal);
  }
}

const opts = (out: string) => ({ display: ":99", width: 1200, height: 800, fps: 30, out });

describe("startRecorder", () => {
  let dir: string;
  let fake: FakeFfmpeg;
  let calls: { bin: string; args: string[] }[];
  const spawn: RecorderSpawn = (bin, args) => {
    calls.push({ bin, args });
    return fake as never;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(path.join(tmpdir(), "aica-rec-test-"));
    fake = new FakeFfmpeg();
    calls = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it("spawns ffmpeg with the record arguments and makes the output directory", () => {
    const out = path.join(dir, "nested", "a.mp4");
    startRecorder(opts(out), spawn);
    expect(calls).toHaveLength(1);
    expect(calls[0].bin).toBe("/usr/bin/ffmpeg");
    expect(calls[0].args).toEqual(recordArgs(opts(out)));
    expect(existsSync(path.join(dir, "nested"))).toBe(true);
  });

  it("is ready after the early-exit window when ffmpeg is still running", async () => {
    const recorder = startRecorder(opts(path.join(dir, "a.mp4")), spawn);
    const ready = recorder.ready();
    await vi.advanceTimersByTimeAsync(600);
    await expect(ready).resolves.toBeUndefined();
  });

  it("rejects ready with ffmpeg's stderr when it exits early", async () => {
    const recorder = startRecorder(opts(path.join(dir, "a.mp4")), spawn);
    const rejected = expect(recorder.ready()).rejects.toThrow(/Cannot open display/);
    fake.stderr.emit("data", Buffer.from("Cannot open display :99\n"));
    fake.exit(1);
    await rejected;
  });

  it("stop writes q and resolves when ffmpeg exits cleanly", async () => {
    const recorder = startRecorder(opts(path.join(dir, "a.mp4")), spawn);
    await vi.advanceTimersByTimeAsync(600);
    const stopped = recorder.stop();
    expect(fake.stdin.writes).toEqual(["q"]);
    fake.exit(0);
    await expect(stopped).resolves.toBeUndefined();
  });

  it("stop rejects when ffmpeg already died, so a scene never passes without a recording", async () => {
    const recorder = startRecorder(opts(path.join(dir, "a.mp4")), spawn);
    fake.stderr.emit("data", Buffer.from("boom"));
    fake.exit(1);
    await expect(recorder.stop()).rejects.toThrow(/boom/);
  });

  it("stop rejects with the stderr tail when ffmpeg exits non-zero after q", async () => {
    const recorder = startRecorder(opts(path.join(dir, "a.mp4")), spawn);
    await vi.advanceTimersByTimeAsync(600);
    const rejected = expect(recorder.stop()).rejects.toThrow(/disk full/);
    fake.stderr.emit("data", Buffer.from("disk full"));
    fake.exit(1);
    await rejected;
  });

  it("escalates SIGINT then SIGKILL when ffmpeg ignores q, and rejects", async () => {
    const recorder = startRecorder(opts(path.join(dir, "a.mp4")), spawn, { stopTimeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(600);
    const rejected = expect(recorder.stop()).rejects.toThrow(/did not stop/);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.kills).toEqual(["SIGINT"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.kills).toEqual(["SIGINT", "SIGKILL"]);
    await rejected;
  });

  it("discard stops and deletes the file", async () => {
    const out = path.join(dir, "a.mp4");
    writeFileSync(out, "x");
    const recorder = startRecorder(opts(out), spawn);
    await vi.advanceTimersByTimeAsync(600);
    const discarded = recorder.discard();
    fake.exit(0);
    await discarded;
    expect(existsSync(out)).toBe(false);
  });

  it("discard still deletes the file and does not throw when ffmpeg failed", async () => {
    const out = path.join(dir, "a.mp4");
    writeFileSync(out, "x");
    const recorder = startRecorder(opts(out), spawn);
    fake.exit(1);
    await expect(recorder.discard()).resolves.toBeUndefined();
    expect(existsSync(out)).toBe(false);
  });
});
