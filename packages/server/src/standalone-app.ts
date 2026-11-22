// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Express } from "express";
import { createApp, type CreateAppOptions } from "./app.js";
import { readAppVersion } from "./composition/app-version.js";
import { bundledDataDirsOf, type BundledDataDirs, type PackageLayout } from "./composition/package-layout.js";
import { clockFromEnv } from "./platform/clock/clock-from-env.js";
import { resolveUserDataDir } from "./platform/vscode-paths/resolve-user-data-dir.js";
import { agentHostCatalogProbe } from "./services/config-check/agent-host-catalog-probe.js";
import { checkConfig } from "./services/config-check/config-check.js";

// The layout replaces the separate data-folder and version options, so
// there is one way to say where the app's files are.
export interface StandaloneAppOptions extends Omit<CreateAppOptions, keyof BundledDataDirs | "appVersion"> {
  // A packaged build's files (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/npm-package.md §4.2); omitted, this package's
  // own, found through import.meta.url (dev).
  layout?: PackageLayout;
  // Where the startup configuration warnings go; stderr by default.
  warn?: (line: string) => void;
}

export interface StandaloneApp {
  app: Express;
  // What /api/health reports, for the entry point's start line.
  version: string;
}

type ConfigCheckPaths = Pick<StandaloneAppOptions, "vscodeSettingsPath" | "agentHostUserDataDir">;

// architecture.md §6.3: the startup check. Omitted paths resolve as they
// always have, so the dev server checks the user's own settings.json.
function warnAboutConfig({ vscodeSettingsPath, agentHostUserDataDir }: ConfigCheckPaths, warn: (line: string) => void): void {
  const { warnings } = checkConfig({
    settingsPath: vscodeSettingsPath,
    agentHostCatalogPresent: agentHostCatalogProbe(agentHostUserDataDir !== undefined ? agentHostUserDataDir : resolveUserDataDir()),
  });
  if (warnings.length === 0) return;
  warn("Configuration warnings (see GET /api/config/status for fix steps):");
  for (const warning of warnings) warn(`  [${warning.code}] ${warning.message}`);
}

// The standalone app's composition root, short of listening: the startup
// configuration check, then the HTTP app over every log provider, reading
// its data and version from the layout when one is given. server.ts (dev)
// and the npm package's CLI (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/npm-package.md §4.4) are thin entries over it;
// each binds its own loopback port and names the Host ports to accept.
// The clock is AGENT_COST_ANALYZER_NOW's unless `now` is given.
export function composeStandaloneApp(options: StandaloneAppOptions = {}): StandaloneApp {
  const { layout, warn = console.warn, now = clockFromEnv(), ...appOptions } = options;
  warnAboutConfig(appOptions, warn);
  const version = readAppVersion(layout?.packageJsonPath);
  const app = createApp({ ...appOptions, ...bundledDataDirsOf(layout), appVersion: version, now });
  return { app, version };
}
