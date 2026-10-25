import { existsSync, renameSync } from "node:fs";
import {
  resolveAppSettingsDir,
  resolveLegacyAppSettingsDirs,
} from "./resolve-app-settings-dir.js";

interface MigrateLegacyAppSettingsDirOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: Record<string, string | undefined>;
  existsSync?: typeof existsSync;
  renameSync?: typeof renameSync;
}

// One-time migration for the 2026-09-25 gh-cp-chat-analyser -> copilot-
// cost-analyzer and 2026-10-25 copilot-cost-analyzer -> agent-cost-analyzer
// renames: moves an existing settings directory from an old name to the
// new one, so renaming the app doesn't orphan local sessions/config. Only
// the newest existing legacy directory moves, so a stale older one is never
// merged in or overwritten. No-op once the new directory exists or no
// legacy directory is there to migrate. Options-injectable for
// testability, mirroring resolveAppSettingsDir.
export function migrateLegacyAppSettingsDir(
  options: MigrateLegacyAppSettingsDirOptions = {},
): void {
  const exists = options.existsSync ?? existsSync;
  const rename = options.renameSync ?? renameSync;

  const currentDir = resolveAppSettingsDir(options);
  if (exists(currentDir)) return;

  const legacyDir = resolveLegacyAppSettingsDirs(options).find((dir) => exists(dir));
  if (legacyDir === undefined) return;

  rename(legacyDir, currentDir);
}
