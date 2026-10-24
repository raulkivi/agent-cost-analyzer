import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_ACTIVE_PROVIDER_ID = "vscode";

interface AppSettingsFileShape {
  activeProviderId?: string;
  minRetainedSessionLogsThreshold?: number;
}

function readSettingsFile(settingsDir: string): Partial<AppSettingsFileShape> {
  const filePath = path.join(settingsDir, "settings.json");
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as Partial<AppSettingsFileShape>;
  } catch {
    return {};
  }
}

// The one file this app ever writes to local disk (architecture.md §11.2).
// Reads the current contents (if any) before writing so unrelated keys
// already on disk survive a write of a single key.
function writeSettingsFile(settingsDir: string, patch: Partial<AppSettingsFileShape>): void {
  mkdirSync(settingsDir, { recursive: true });
  const filePath = path.join(settingsDir, "settings.json");
  const payload: AppSettingsFileShape = { ...readSettingsFile(settingsDir), ...patch };
  writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf-8");
}

// A missing file (first run) or a corrupt one both degrade to the default
// provider id rather than crashing startup — this is app-owned config, not
// a load-bearing store.
export function readActiveProviderId(settingsDir: string): string {
  const raw = readSettingsFile(settingsDir);
  return typeof raw.activeProviderId === "string" ? raw.activeProviderId : DEFAULT_ACTIVE_PROVIDER_ID;
}

export function writeActiveProviderId(settingsDir: string, activeProviderId: string): void {
  writeSettingsFile(settingsDir, { activeProviderId });
}

// A missing file, a corrupt one, or a missing/non-number key all degrade to
// undefined — callers fall back to their own default (config-check.ts owns
// the 200 default, per architecture.md §13).
export function readMinRetainedSessionLogsThreshold(settingsDir: string): number | undefined {
  const raw = readSettingsFile(settingsDir);
  return typeof raw.minRetainedSessionLogsThreshold === "number"
    ? raw.minRetainedSessionLogsThreshold
    : undefined;
}

export function writeMinRetainedSessionLogsThreshold(
  settingsDir: string,
  minRetainedSessionLogsThreshold: number,
): void {
  writeSettingsFile(settingsDir, { minRetainedSessionLogsThreshold });
}
