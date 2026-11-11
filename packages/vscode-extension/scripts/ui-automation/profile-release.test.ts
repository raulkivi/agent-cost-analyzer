// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { parsePsOutput, profileHolders, type ProcessInfo, releaseProfile, type ReleaseDeps } from "./profile-release.mts";

const DIR = "/tmp/aica-copilot-e2e-abc/storage/settings";

describe("parsePsOutput (ps -eww -o pid=,args=)", () => {
  it("reads each line's pid and full command line", () => {
    const text = "    12 /opt/code --user-data-dir=/x --type=renderer\n  3456 node worker.js\n\n";

    expect(parsePsOutput(text)).toEqual([
      { pid: 12, args: "/opt/code --user-data-dir=/x --type=renderer" },
      { pid: 3456, args: "node worker.js" },
    ]);
  });

  it("skips lines without a pid", () => {
    expect(parsePsOutput("garbage\n  7 ok")).toEqual([{ pid: 7, args: "ok" }]);
  });
});

describe("profileHolders (VS Code processes still on the run's profile)", () => {
  it("finds every process started with that user-data dir, main and children", () => {
    const processes: ProcessInfo[] = [
      { pid: 1, args: `/opt/code --allow-pre-commit-input --user-data-dir=${DIR} --extensions-dir=/e` },
      { pid: 2, args: `/opt/code --type=renderer --user-data-dir=${DIR}` },
      { pid: 3, args: "/opt/code --user-data-dir=/home/owner/.config/Code" },
      { pid: 4, args: "node wdio worker" },
    ];

    expect(profileHolders(processes, DIR)).toEqual([1, 2]);
  });

  it("doesn't take a longer path that only starts with the dir", () => {
    expect(profileHolders([{ pid: 9, args: `/opt/code --user-data-dir=${DIR}-other --x` }], DIR)).toEqual([]);
  });

  it("never names the caller itself", () => {
    expect(profileHolders([{ pid: 5, args: `node --user-data-dir=${DIR}` }], DIR, 5)).toEqual([]);
  });
});

// A fake clock and process table: each sleep advances time; `exitAt` says when a pid goes away by itself.
function fakeDeps(exitAt: Record<number, number>, options: { ignoresTerm?: boolean } = {}) {
  let now = 0;
  const alive = new Set(Object.keys(exitAt).map(Number));
  const signals: [number, string][] = [];
  const lines: string[] = [];
  const deps: ReleaseDeps = {
    list: () => {
      for (const pid of [...alive]) if (now >= exitAt[pid]!) alive.delete(pid);
      return [...alive].map((pid) => ({ pid, args: `/opt/code --user-data-dir=${DIR}` }));
    },
    kill: (pid, signal) => {
      signals.push([pid, signal]);
      if (signal === "SIGKILL" || !options.ignoresTerm) alive.delete(pid);
    },
    sleep: async (ms) => {
      now += ms;
    },
    now: () => now,
    log: (line) => lines.push(line),
  };
  return { deps, signals, lines, elapsed: () => now };
}

describe("releaseProfile (before the next spec file's VS Code starts on the same profile)", () => {
  const limits = { graceMs: 10_000, termMs: 3_000, pollMs: 500 };

  it("returns at once when nothing holds the profile", async () => {
    const { deps, signals } = fakeDeps({});

    expect(await releaseProfile(DIR, deps, limits)).toEqual({ released: true, waitedMs: 0, terminated: [], killed: [] });
    expect(signals).toEqual([]);
  });

  it("waits for a VS Code that is still shutting down, and kills nothing", async () => {
    const { deps, signals } = fakeDeps({ 10: 2_000, 11: 1_500 });

    const result = await releaseProfile(DIR, deps, limits);

    expect(result).toEqual({ released: true, waitedMs: 2_000, terminated: [], killed: [] });
    expect(signals).toEqual([]);
  });

  it("after the grace period, terminates a VS Code that won't quit (a quit confirmation it can't show), and says so", async () => {
    const { deps, signals, lines } = fakeDeps({ 10: Number.POSITIVE_INFINITY });

    const result = await releaseProfile(DIR, deps, limits);

    expect(result).toMatchObject({ released: true, terminated: [10], killed: [] });
    expect(signals).toEqual([[10, "SIGTERM"]]);
    expect(lines.join("\n")).toContain("10");
  });

  it("kills what ignores SIGTERM", async () => {
    const { deps, signals } = fakeDeps({ 10: Number.POSITIVE_INFINITY }, { ignoresTerm: true });

    const result = await releaseProfile(DIR, deps, limits);

    expect(result).toMatchObject({ released: true, terminated: [10], killed: [10] });
    expect(signals).toEqual([
      [10, "SIGTERM"],
      [10, "SIGKILL"],
    ]);
  });

  it("never throws when signalling fails, and reports the profile still held if it is", async () => {
    const { deps } = fakeDeps({ 10: Number.POSITIVE_INFINITY });
    const failingKill: ReleaseDeps = {
      ...deps,
      kill: () => {
        throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
      },
    };

    await expect(releaseProfile(DIR, failingKill, limits)).resolves.toMatchObject({ released: false });
  });
});
