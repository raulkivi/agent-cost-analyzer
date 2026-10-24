import path from "node:path";

// Conventional location for HAR exports the user drops in manually — a
// subdirectory of this app's own settings dir (platform/app-settings-dir),
// so there's exactly one local "app owns this" directory to document
// rather than a second bespoke config value (phase-9-log-providers-
// implementation.md §6/§12 — "whether the app-owned settings file should
// ever hold more than the active provider id" stays an open question
// precisely because this convention avoids needing it for the MVP).
export function resolveMitmproxyCapturesDir(appSettingsDir: string): string {
  return path.join(appSettingsDir, "mitmproxy-captures");
}
