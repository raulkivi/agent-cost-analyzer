import { existsSync } from "node:fs";
import path from "node:path";
import { resolveUserDataDir } from "../../platform/vscode-paths/resolve-user-data-dir.js";

interface ResolveVscodeSettingsPathOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
}

// <userData>/User/settings.json, whether or not it exists.
export function userSettingsFilePath(userDataDir: string): string {
  return path.join(userDataDir, "User", "settings.json");
}

export function resolveVscodeSettingsPath(
  options: ResolveVscodeSettingsPathOptions = {},
): string | null {
  const userDataDir = resolveUserDataDir(options);
  if (!userDataDir) {
    return null;
  }

  const settingsPath = userSettingsFilePath(userDataDir);
  return existsSync(settingsPath) ? settingsPath : null;
}
