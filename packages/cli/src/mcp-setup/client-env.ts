// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { access, constants, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { pathFlavor } from "./client-paths.js";
import { configFileRefusal } from "./config-limits.js";

/** Everything adapters need to know about the machine, injected (DIP). */
export interface ClientEnv {
  platform: NodeJS.Platform;
  home: string;
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  onPath(cmd: string): Promise<boolean>;
  exists(path: string): Promise<boolean>;
  /** Entry names of a folder; a missing or unreadable folder is empty. */
  readDir(path: string): Promise<string[]>;
  /**
   * File text, or undefined when the file is missing or unreadable. Rejects
   * a path that is not a regular file or is too large to be a config.
   */
  readText(path: string): Promise<string | undefined>;
}

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/** Every file name a shell could run for `cmd`, in PATH order. Pure. */
export function pathCandidates(
  cmd: string,
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  const p = pathFlavor(platform);
  const windows = platform === "win32";
  // Windows environment variable names are case-insensitive: "Path".
  const key = Object.keys(env).find((k) =>
    windows ? k.toUpperCase() === "PATH" : k === "PATH",
  );
  const dirs = (key ? (env[key] ?? "") : "").split(p.delimiter).filter(Boolean);
  const exts = windows
    ? (env.PATHEXT || DEFAULT_PATHEXT).split(";").filter(Boolean)
    : [""];
  return dirs.flatMap((dir) => exts.map((ext) => p.join(dir, cmd + ext)));
}

async function readConfigText(path: string): Promise<string | undefined> {
  const stats = await stat(path).catch(() => undefined);
  if (!stats) return undefined;
  const refusal = configFileRefusal(path, stats);
  if (refusal) throw new Error(refusal);
  return readFile(path, "utf8").catch(() => undefined);
}

async function isRunnable(path: string, platform: NodeJS.Platform) {
  try {
    if (!(await stat(path)).isFile()) return false;
    // Windows has no execute bit; the extension from PATHEXT decides.
    if (platform !== "win32") await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function createClientEnv(
  base: Partial<Pick<ClientEnv, "platform" | "home" | "cwd" | "env">> = {},
): ClientEnv {
  const platform = base.platform ?? process.platform;
  const env = base.env ?? process.env;
  return {
    platform,
    home: base.home ?? homedir(),
    cwd: base.cwd ?? process.cwd(),
    env,
    // Scans PATH with fs instead of asking a shell, so nothing is executed.
    async onPath(cmd) {
      for (const candidate of pathCandidates(cmd, platform, env))
        if (await isRunnable(candidate, platform)) return true;
      return false;
    },
    exists: (path) =>
      access(path).then(
        () => true,
        () => false,
      ),
    readDir: (path) => readdir(path).catch(() => []),
    readText: readConfigText,
  };
}
