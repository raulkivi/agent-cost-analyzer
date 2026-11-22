// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Browser opener (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/npm-package.md §4.5). One opener per OS, run without a
// shell. The URL is built only from 127.0.0.1 and a validated port.
import { spawn } from "node:child_process";

export interface SpawnedChild {
  unref(): void;
  once(event: "spawn", listener: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
}

export type Spawner = (
  program: string,
  args: readonly string[],
  options: { shell: false; detached: true; stdio: "ignore" },
) => SpawnedChild;

export type OpenResult =
  | { status: "opened" }
  | { status: "skipped"; reason: "open:false" | "CI" | "no-display" | "unsupported-platform" }
  | { status: "failed"; message: string };

export interface OpenOptions {
  port: number;
  /** False for `--no-open`. Defaults to true. */
  open?: boolean;
  platform?: NodeJS.Platform;
  env?: Readonly<Record<string, string | undefined>>;
  spawner?: Spawner;
}

export function loopbackUrl(port: number): string {
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError(`Invalid port: ${String(port)}`);
  }
  return `http://127.0.0.1:${port}/`;
}

function openerFor(platform: NodeJS.Platform, url: string): [string, string[]] | undefined {
  switch (platform) {
    case "darwin":
      return ["open", [url]];
    case "linux":
      return ["xdg-open", [url]];
    case "win32":
      // Not `cmd /c start`: cmd would parse the argument as shell text.
      return ["rundll32", ["url.dll,FileProtocolHandler", url]];
    default:
      return undefined;
  }
}

const defaultSpawner: Spawner = (program, args, options) => spawn(program, [...args], options);

export async function openBrowser(options: OpenOptions): Promise<OpenResult> {
  const url = loopbackUrl(options.port);
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (options.open === false) return { status: "skipped", reason: "open:false" };
  if (env.CI) return { status: "skipped", reason: "CI" };
  if (platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
    return { status: "skipped", reason: "no-display" };
  }
  const opener = openerFor(platform, url);
  if (!opener) return { status: "skipped", reason: "unsupported-platform" };

  const [program, args] = opener;
  const spawner = options.spawner ?? defaultSpawner;
  try {
    const child = spawner(program, args, { shell: false, detached: true, stdio: "ignore" });
    // Resolve on the child's own outcome: a missing program surfaces as an
    // async `error` event, which would crash the process if unhandled.
    return await new Promise<OpenResult>((resolve) => {
      child.once("error", (error) => resolve({ status: "failed", message: error.message }));
      child.once("spawn", () => {
        child.unref();
        resolve({ status: "opened" });
      });
    });
  } catch (error) {
    return { status: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}
