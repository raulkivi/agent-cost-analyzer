// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

export const SETTINGS_FILE_NAME = "settings.json";

// The file operations the writer needs, so a test can make one of them fail.
export interface SettingsFileFs {
  existsSync: typeof existsSync;
  mkdirSync: typeof mkdirSync;
  readFileSync: typeof readFileSync;
  renameSync: typeof renameSync;
  rmSync: typeof rmSync;
  writeFileSync: typeof writeFileSync;
}

const nodeFs: SettingsFileFs = { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync };

// A missing, corrupt or non-object file reads as {}: app-owned config is not
// a load-bearing store, so nothing here throws.
export function readSettingsFile(settingsDir: string, fs: SettingsFileFs = nodeFs): Record<string, unknown> {
  const filePath = path.join(settingsDir, SETTINGS_FILE_NAME);
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

// The one file this app writes besides projects.json and statements
// (architecture.md §11.2). Reads the current contents first so keys this
// caller does not own survive. The new contents go to a temporary file in the
// same folder (mode 0600), then rename over the old file, so a second reader
// process never sees a torn file (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/monthly-allowance-standalone.md D10).
export function writeSettingsFile(
  settingsDir: string,
  patch: Record<string, unknown>,
  fs: SettingsFileFs = nodeFs,
): void {
  fs.mkdirSync(settingsDir, { recursive: true });
  const filePath = path.join(settingsDir, SETTINGS_FILE_NAME);
  const payload = { ...readSettingsFile(settingsDir, fs), ...patch };
  const temporary = path.join(settingsDir, `.${SETTINGS_FILE_NAME}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(payload, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(temporary, filePath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
