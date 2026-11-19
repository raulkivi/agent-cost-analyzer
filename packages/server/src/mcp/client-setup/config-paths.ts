// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { posix, win32, type PlatformPath } from "node:path";

/** The slice of the machine that user-level config paths depend on. */
export interface PathEnv {
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * Path rules of the target platform, not the host's: a Windows config path
 * must come out with backslashes however the code is run (tests on Linux CI).
 */
export function pathFlavor(platform: NodeJS.Platform): PlatformPath {
  return platform === "win32" ? win32 : posix;
}

/** The per-user config root of an Electron app on the target platform. */
function appDataDir(env: PathEnv): string {
  const p = pathFlavor(env.platform);
  if (env.platform === "darwin")
    return p.join(env.home, "Library", "Application Support");
  if (env.platform === "win32")
    return env.env.APPDATA || p.join(env.home, "AppData", "Roaming");
  return env.env.XDG_CONFIG_HOME || p.join(env.home, ".config");
}

export function claudeDesktopConfigPath(env: PathEnv): string {
  return pathFlavor(env.platform).join(
    appDataDir(env),
    "Claude",
    "claude_desktop_config.json",
  );
}

export function cursorUserConfigPath(env: PathEnv): string {
  return pathFlavor(env.platform).join(env.home, ".cursor", "mcp.json");
}

/** VS Code's user folder, which holds `mcp.json` and `settings.json`. */
export function vscodeUserDir(env: PathEnv): string {
  return pathFlavor(env.platform).join(appDataDir(env), "Code", "User");
}

/** Insiders is a separate install with its own profile folder. */
export function vscodeInsidersUserDir(env: PathEnv): string {
  return pathFlavor(env.platform).join(
    appDataDir(env),
    "Code - Insiders",
    "User",
  );
}

export function vscodeInsidersConfigPath(env: PathEnv): string {
  return pathFlavor(env.platform).join(vscodeInsidersUserDir(env), "mcp.json");
}

export function vscodeInsidersExtensionsDir(env: PathEnv): string {
  return pathFlavor(env.platform).join(
    env.home,
    ".vscode-insiders",
    "extensions",
  );
}

export function vscodeConfigPath(env: PathEnv): string {
  return pathFlavor(env.platform).join(vscodeUserDir(env), "mcp.json");
}

/** Where VS Code unpacks installed extensions, one folder per version. */
export function vscodeExtensionsDir(env: PathEnv): string {
  return pathFlavor(env.platform).join(env.home, ".vscode", "extensions");
}

export function codexHome(env: PathEnv): string {
  return (
    env.env.CODEX_HOME || pathFlavor(env.platform).join(env.home, ".codex")
  );
}

export function codexConfigPath(env: PathEnv): string {
  return pathFlavor(env.platform).join(codexHome(env), "config.toml");
}

export function geminiHome(env: PathEnv): string {
  return pathFlavor(env.platform).join(env.home, ".gemini");
}

export function geminiUserSettingsPath(env: PathEnv): string {
  return pathFlavor(env.platform).join(geminiHome(env), "settings.json");
}
