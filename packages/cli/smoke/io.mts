// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The npm-package smoke's processes and HTTP requests: thin wrappers whose
// decisions (programs, arguments, stop action, checks) live in the pure
// modules beside them.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { request } from "node:http";
import { createInterface } from "node:readline";
import type { HttpReply } from "./checks.mts";
import { stopAction, type Invocation } from "./processes.mts";

export interface Running {
  child: ChildProcessWithoutNullStreams;
  stderr(): string;
  /** The exit code, or the signal's name when a signal ended it. */
  exited: Promise<number | string>;
}

export interface RunOptions {
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
}

export function start(run: Invocation, options: RunOptions): Running {
  const child = spawn(run.command, run.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: "pipe",
    windowsVerbatimArguments: run.windowsVerbatimArguments ?? false,
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  const exited = new Promise<number | string>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve(code ?? signal ?? "unknown"));
  });
  return { child, stderr: () => stderr, exited };
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} s`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface Finished {
  code: number | string;
  stdout: string;
  stderr: string;
}

/** Runs a command to its end; `echo` copies its output to this process's as it comes. */
export async function runToEnd(run: Invocation, options: RunOptions & { timeoutMs: number; echo?: boolean }): Promise<Finished> {
  const running = start(run, options);
  running.child.stdin.end();
  let stdout = "";
  running.child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
    if (options.echo === true) process.stdout.write(chunk);
  });
  if (options.echo === true) running.child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  try {
    const code = await withTimeout(running.exited, options.timeoutMs, `${run.command} ${run.args.join(" ")}`);
    return { code, stdout, stderr: running.stderr() };
  } catch (error) {
    await kill(running);
    throw error;
  }
}

/** The first line the process writes to stdout; the rest is collected into `rest`. */
export async function firstStdoutLine(running: Running, timeoutMs: number, rest: string[]): Promise<string> {
  const lines = createInterface({ input: running.child.stdout });
  const first = new Promise<string>((resolve, reject) => {
    let seen = false;
    lines.on("line", (line) => {
      if (seen) rest.push(line);
      else {
        seen = true;
        resolve(line);
      }
    });
    lines.once("close", () => reject(new Error(`stdout closed before the first line; stderr:\n${running.stderr()}`)));
  });
  return withTimeout(first, timeoutMs, "the first stdout line");
}

/** Ctrl+C (SIGINT), or the process-tree kill on Windows; resolves to how the process ended. */
export async function stop(running: Running, platform: NodeJS.Platform, timeoutMs: number): Promise<number | string> {
  if (running.child.exitCode !== null) return running.exited;
  const action = stopAction(platform, running.child.pid ?? 0);
  if (action.kind === "signal") running.child.kill(action.signal);
  else await runToEnd(action.invocation, { cwd: process.cwd(), env: process.env, timeoutMs });
  try {
    return await withTimeout(running.exited, timeoutMs, "stopping the server");
  } catch (error) {
    await kill(running);
    throw error;
  }
}

/** A last resort for cleanup: SIGKILL, or the forced tree kill on Windows. */
export async function kill(running: Running): Promise<void> {
  if (running.child.exitCode !== null || running.child.signalCode !== null) return;
  if (process.platform === "win32" && running.child.pid !== undefined) {
    const action = stopAction("win32", running.child.pid);
    if (action.kind === "command") spawn(action.invocation.command, action.invocation.args, { stdio: "ignore" });
  } else running.child.kill("SIGKILL");
  await withTimeout(running.exited, 10_000, "killing a process").catch(() => undefined);
}

/** A GET to the server on 127.0.0.1, optionally with other headers (such as a foreign Host). */
export function httpGet(port: number, urlPath: string, headers: Record<string, string> = {}): Promise<HttpReply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: urlPath, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.setTimeout(15_000, () => req.destroy(new Error(`GET ${urlPath} timed out`)));
    req.on("error", reject);
    req.end();
  });
}
