// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readlinkSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { FRAME } from "../ffmpeg-args.mts";
import type { Xdotool } from "./xdotool.mts";

export const DESKTOP_BINARY = "/usr/lib/claude-desktop/claude-desktop";

// Electron's SingletonLock is a symlink to "<host>-<pid>"; a live pid means the profile is in use.
export function lockHolderPid(lockTarget: string | undefined): number | undefined {
  const pid = Number(lockTarget?.match(/-(\d+)$/)?.[1]);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

export function profileInUse(
  profileDir: string,
  isAlive: (pid: number) => boolean = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
): boolean {
  let target: string | undefined;
  try {
    target = readlinkSync(`${profileDir}/Claude/SingletonLock`);
  } catch {
    return false;
  }
  const pid = lockHolderPid(target);
  return pid !== undefined && isAlive(pid);
}

export function freeDisplay(taken: (file: string) => boolean = existsSync, first = 90): string {
  for (let n = first; n < first + 40; n++) {
    if (!taken(`/tmp/.X11-unix/X${n}`) && !taken(`/tmp/.X${n}-lock`)) return `:${n}`;
  }
  throw new Error(`No free X display between :${first} and :${first + 39}`);
}

export interface DesktopSession {
  display: string;
  xdo: Xdotool;
  stop(): Promise<void>;
}

async function waitUntil(what: string, timeoutMs: number, ok: () => Promise<boolean> | boolean): Promise<void> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(250)) if (await ok()) return;
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`);
}

async function endProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(killTimer);
}

// Own Xvfb at the demo frame, then Claude Desktop on `profileDir`, fitted to the frame. stop() is safe to call twice.
export async function startDesktopSession(
  profileDir: string,
  makeXdotool: (display: string) => Xdotool,
  log: (line: string) => void,
): Promise<DesktopSession> {
  const display = freeDisplay();
  const children: ChildProcess[] = [];
  const stop = async () => {
    for (const child of children.splice(0).reverse()) await endProcess(child);
  };
  try {
    const xvfb = spawn("Xvfb", [display, "-screen", "0", `${FRAME.width}x${FRAME.height}x24`, "-nolisten", "tcp"], { stdio: "ignore" });
    children.push(xvfb);
    await waitUntil(`Xvfb ${display}`, 10_000, () => existsSync(`/tmp/.X11-unix/X${display.slice(1)}`));

    const env: NodeJS.ProcessEnv = { ...process.env, DISPLAY: display, XDG_CONFIG_HOME: profileDir };
    delete env.WAYLAND_DISPLAY;
    const desktop = spawn(DESKTOP_BINARY, ["--ozone-platform=x11"], { env, stdio: "ignore" });
    children.push(desktop);
    log(`Xvfb ${display}, Claude Desktop pid ${desktop.pid}`);

    const xdo = makeXdotool(display);
    let id: string | undefined;
    await waitUntil("the Claude Desktop window", 60_000, async () => (id = await xdo.findWindow("claude")) !== undefined);
    await sleep(2000);
    await xdo.fitWindow(id!, FRAME);
    await sleep(1500);
    return { display, xdo, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
