// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { posix, win32, type PlatformPath } from "node:path";
import type { ClientEnv } from "./client-env.js";

/**
 * Path rules of the target platform, not the host's: a Windows config path
 * must come out with backslashes however the code is run (tests on Linux CI).
 */
export function pathFlavor(platform: NodeJS.Platform): PlatformPath {
  return platform === "win32" ? win32 : posix;
}

export function claudeDesktopConfigPath(env: ClientEnv): string {
  const p = pathFlavor(env.platform);
  const file = "claude_desktop_config.json";
  if (env.platform === "darwin")
    return p.join(env.home, "Library", "Application Support", "Claude", file);
  if (env.platform === "win32")
    return p.join(
      env.env.APPDATA || p.join(env.home, "AppData", "Roaming"),
      "Claude",
      file,
    );
  return p.join(
    env.env.XDG_CONFIG_HOME || p.join(env.home, ".config"),
    "Claude",
    file,
  );
}

export function cursorConfigPath(
  scope: "user" | "project",
  env: ClientEnv,
): string {
  const base = scope === "user" ? env.home : env.cwd;
  return pathFlavor(env.platform).join(base, ".cursor", "mcp.json");
}
