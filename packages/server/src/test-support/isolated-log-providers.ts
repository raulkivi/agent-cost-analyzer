// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import type { LogProviderCompositionOptions } from "../composition/compose-log-providers.js";

// The standalone composition with every log path inside `dir` or switched
// off, so a test reads no log, settings file or app settings folder of the
// machine it runs on (and moves no legacy settings folder).
export function isolatedLogProviders(dir: string): LogProviderCompositionOptions {
  return {
    sessionStoreDbPath: path.join(dir, "no-session-store.db"),
    debugLogsDirPaths: [],
    vscodeSettingsPath: null,
    agentTracesDbPath: null,
    agentHostUserDataDir: null,
    copilotHome: null,
    appSettingsDir: path.join(dir, "app-settings"),
    mitmproxyCapturesDirPath: null,
    piAgentSessionsDirPath: null,
    systemPromptLogPath: null,
    claudeCodeProjectsDirPath: null,
  };
}
