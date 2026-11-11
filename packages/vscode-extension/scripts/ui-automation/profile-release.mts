// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Every spec file of the real-Copilot suite starts its own VS Code on the same
// profile copy (--user-data-dir). VS Code is single-instance per profile: a
// launch that finds one still running hands over to it and exits, which
// chromedriver reports as "session not created: Chrome instance exited". After
// real chats on VS Code 1.146 the previous VS Code didn't quit (owner's release
// run on 5922f21): with a chat request or agent session still in progress,
// quitting waits on a confirmation nobody answers, chromedriver then kills only
// wdio-vscode-service's launcher shim, and the orphaned VS Code keeps the
// profile. The suite's config calls releaseProfile from onWorkerEnd, which the
// wdio launcher awaits before it starts the next spec file: it waits for the
// previous VS Code to go, then terminates, then kills what is left.
import { execFileSync } from "node:child_process";
import process from "node:process";

export interface ProcessInfo {
  pid: number;
  args: string;
}

// `ps -eww -o pid=,args=`: the pid, then the whole command line.
export function parsePsOutput(text: string): ProcessInfo[] {
  return text.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    return match ? [{ pid: Number(match[1]), args: match[2]!.trimEnd() }] : [];
  });
}

// VS Code's main process and its Chromium children all carry the flag.
export function profileHolders(processes: readonly ProcessInfo[], userDataDir: string, self = -1): number[] {
  const flag = `--user-data-dir=${userDataDir}`;
  return processes.filter(({ pid, args }) => pid !== self && args.split(/\s+/).includes(flag)).map(({ pid }) => pid);
}

export interface ReleaseDeps {
  list(): ProcessInfo[];
  kill(pid: number, signal: "SIGTERM" | "SIGKILL"): void;
  sleep(ms: number): Promise<void>;
  now(): number;
  log(line: string): void;
}

export interface ReleaseLimits {
  // How long a VS Code may take to quit on its own.
  graceMs: number;
  // How long after each signal before the next step.
  termMs: number;
  pollMs: number;
}

export const RELEASE_LIMITS: ReleaseLimits = { graceMs: 30_000, termMs: 5_000, pollMs: 250 };

export interface ReleaseResult {
  released: boolean;
  waitedMs: number;
  terminated: number[];
  killed: number[];
}

export async function releaseProfile(userDataDir: string, deps: ReleaseDeps, limits: ReleaseLimits = RELEASE_LIMITS, self = process.pid): Promise<ReleaseResult> {
  const started = deps.now();
  const holders = () => profileHolders(deps.list(), userDataDir, self);
  const waitUntilFree = async (limitMs: number): Promise<number[]> => {
    const until = deps.now() + limitMs;
    let pids = holders();
    while (pids.length > 0 && deps.now() < until) {
      await deps.sleep(limits.pollMs);
      pids = holders();
    }
    return pids;
  };
  const signal = (pids: number[], name: "SIGTERM" | "SIGKILL") => {
    deps.log(`VS Code still holds the profile after ${((deps.now() - started) / 1000).toFixed(1)} s: ${name} to ${pids.join(", ")}`);
    for (const pid of pids) {
      try {
        deps.kill(pid, name);
      } catch {
        // Gone already, or not ours to signal: the next listing says which.
      }
    }
  };

  let pids = await waitUntilFree(limits.graceMs);
  const terminated: number[] = [];
  const killed: number[] = [];
  if (pids.length > 0) {
    signal(pids, "SIGTERM");
    terminated.push(...pids);
    pids = await waitUntilFree(limits.termMs);
  }
  if (pids.length > 0) {
    signal(pids, "SIGKILL");
    killed.push(...pids);
    pids = await waitUntilFree(limits.termMs);
  }
  if (pids.length > 0) deps.log(`the profile is still held by ${pids.join(", ")}: the next VS Code launch will fail`);
  return { released: pids.length === 0, waitedMs: deps.now() - started, terminated, killed };
}

// TDD exception: the real process table and signals.
export function nodeReleaseDeps(log: (line: string) => void): ReleaseDeps {
  return {
    list: () => parsePsOutput(execFileSync("ps", ["-eww", "-o", "pid=,args="], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 })),
    kill: (pid, name) => process.kill(pid, name),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
    log,
  };
}
