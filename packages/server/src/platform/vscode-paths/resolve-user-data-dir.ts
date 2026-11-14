// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

interface ResolveUserDataDirOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: Record<string, string | undefined>;
  exists?: (candidate: string) => boolean;
}

// VS Code user-data roots (callers append "User/..."); Insiders first, then Stable.
// path.posix/path.win32 keep results deterministic on whatever OS runs the tests.
function candidateDirs(
  platform: NodeJS.Platform,
  homeDir: string,
  env: Record<string, string | undefined>,
): string[] {
  if (platform === "darwin") {
    const base = path.posix.join(homeDir, "Library", "Application Support");
    return [path.posix.join(base, "Code - Insiders"), path.posix.join(base, "Code")];
  }
  if (platform === "win32") {
    const appData = env.APPDATA ?? path.win32.join(homeDir, "AppData", "Roaming");
    return [path.win32.join(appData, "Code - Insiders"), path.win32.join(appData, "Code")];
  }
  if (platform === "linux") {
    return [
      path.posix.join(homeDir, ".config", "Code - Insiders"),
      path.posix.join(homeDir, ".config", "Code"),
    ];
  }
  return [];
}

// A variant counts only when its root holds a `User` folder: a bare root (e.g. only
// "Azure Accounts") is not a VS Code profile. The check goes through `exists`, so a
// root without `User` is skipped whichever OS path style applies.
function hasUserFolder(
  root: string,
  platform: NodeJS.Platform,
  exists: (candidate: string) => boolean,
): boolean {
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  return exists(join(root, "User"));
}

// Qualifying roots in preference order: Insiders first, then Stable.
export function listVscodeUserDataRoots(options: ResolveUserDataDirOptions = {}): string[] {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? homedir();
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;

  return candidateDirs(platform, homeDir, env).filter((root) =>
    hasUserFolder(root, platform, exists),
  );
}

export function resolveUserDataDir(options: ResolveUserDataDirOptions = {}): string | null {
  return listVscodeUserDataRoots(options)[0] ?? null;
}
