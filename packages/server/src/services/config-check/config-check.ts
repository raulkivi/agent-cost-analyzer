import type { ConfigStatus, ConfigWarning } from "@agent-cost-analyzer/domain";
import { snapshotFromSettings } from "../../data-sources/vscode-settings/read-vscode-settings.js";
import { JsoncFileSettingsSource } from "../../data-sources/vscode-settings/jsonc-file-settings-source.js";
import { resolveVscodeSettingsPath } from "../../data-sources/vscode-settings/vscode-settings-path.js";
import type { SettingsSource } from "./settings-source.js";

const LOGGING_ENABLED_SETTING_ID =
  "github.copilot.chat.agentDebugLog.fileLogging.enabled";
const MAX_RETAINED_SESSION_LOGS_SETTING_ID =
  "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs";
const MIN_RETAINED_SESSION_LOGS = 200;
// VS Code's own default when the setting is unset (architecture.md constraint 10).
const DEFAULT_RETAINED_SESSION_LOGS = 50;
// Phase 8.5: optional — gates agent-traces.db, unlike the other three
// settings above, which are prerequisites for any usage data at all.
const AGENT_TRACES_ENABLED_SETTING_ID =
  "github.copilot.chat.otel.dbSpanExporter.enabled";

function buildSettingsNotFoundWarning(): ConfigWarning {
  return {
    code: "settings-not-found",
    severity: "required",
    settingId: LOGGING_ENABLED_SETTING_ID,
    currentValue: null,
    recommendedValue: true,
    message:
      "Could not locate a VS Code user settings.json on this machine, so " +
      "prerequisite Copilot Chat logging settings could not be checked.",
    helpSteps: [
      "Confirm VS Code (Stable or Insiders) is installed on this machine.",
      "Open VS Code at least once so its user-data directory is created, then restart this app.",
    ],
  };
}

// How the help steps name the file when the source doesn't know its path.
const GENERIC_SETTINGS_LABEL = "your VS Code user settings.json";

function buildLoggingDisabledWarning(settingsPath: string): ConfigWarning {
  return {
    code: "logging-disabled",
    severity: "required",
    settingId: LOGGING_ENABLED_SETTING_ID,
    currentValue: false,
    recommendedValue: true,
    message:
      "GitHub Copilot Chat debug logging is disabled, so future sessions will have no " +
      "per-turn usage data to analyze.",
    helpSteps: [
      `Open ${settingsPath} and add "${LOGGING_ENABLED_SETTING_ID}": true`,
      "Reload the VS Code window for the change to take effect.",
    ],
  };
}

function buildRetentionTooLowWarning(
  settingsPath: string,
  currentValue: number,
  threshold: number,
): ConfigWarning {
  return {
    code: "retention-too-low",
    severity: "required",
    settingId: MAX_RETAINED_SESSION_LOGS_SETTING_ID,
    currentValue,
    recommendedValue: threshold,
    message:
      `Only the last ${currentValue} sessions' logs are retained on disk, which limits ` +
      `how much history Analyze mode can show. At least ${threshold} is recommended.`,
    helpSteps: [
      `Open ${settingsPath} and add "${MAX_RETAINED_SESSION_LOGS_SETTING_ID}": ${threshold}`,
      "Reload the VS Code window for the change to take effect.",
    ],
  };
}

function buildAgentTracesUnavailableWarning(settingsPath: string): ConfigWarning {
  return {
    code: "agent-traces-unavailable",
    severity: "optional",
    settingId: AGENT_TRACES_ENABLED_SETTING_ID,
    currentValue: false,
    recommendedValue: true,
    message:
      "Cache-write and reasoning-token counts aren't available for Analyze mode " +
      "turns yet — enabling this optional setting unlocks two more usage figures " +
      "for future sessions.",
    helpSteps: [
      `Open ${settingsPath} and add "${AGENT_TRACES_ENABLED_SETTING_ID}": true`,
      "Reload the VS Code window for the change to take effect.",
    ],
  };
}

export interface CheckConfigOptions {
  // Where to read the settings from; wins over settingsPath/platform/homeDir.
  // Omitted reads the user settings.json file (the standalone app's source).
  settings?: SettingsSource;
  // string | null overrides resolution outright (used by tests and the API layer,
  // which resolves the path once at server boot); omitted resolves it fresh.
  settingsPath?: string | null;
  platform?: NodeJS.Platform;
  homeDir?: string;
  now?: () => string;
  minRetainedSessionLogsThreshold?: number;
}

export function checkConfig(options: CheckConfigOptions = {}): ConfigStatus {
  const source =
    options.settings ??
    new JsoncFileSettingsSource(
      options.settingsPath !== undefined ? options.settingsPath : resolveVscodeSettingsPath(options),
    );
  const { located, userSettingsPath } = source.describe();
  const settingsLabel = userSettingsPath ?? GENERIC_SETTINGS_LABEL;
  const settings = snapshotFromSettings(source);
  const now = options.now ?? (() => new Date().toISOString());
  const minRetainedSessionLogsThreshold =
    options.minRetainedSessionLogsThreshold ?? MIN_RETAINED_SESSION_LOGS;

  const warnings: ConfigWarning[] = [];
  if (!located) {
    warnings.push(buildSettingsNotFoundWarning());
  } else {
    if (!settings.loggingEnabled) {
      warnings.push(buildLoggingDisabledWarning(settingsLabel));
    }
    const effectiveMaxRetained =
      settings.maxRetainedSessionLogs ?? DEFAULT_RETAINED_SESSION_LOGS;
    if (effectiveMaxRetained < minRetainedSessionLogsThreshold) {
      warnings.push(
        buildRetentionTooLowWarning(
          settingsLabel,
          effectiveMaxRetained,
          minRetainedSessionLogsThreshold,
        ),
      );
    }
    if (!settings.agentTracesEnabled) {
      warnings.push(buildAgentTracesUnavailableWarning(settingsLabel));
    }
  }

  return {
    checkedAt: now(),
    vscodeUserSettingsPath: userSettingsPath,
    loggingEnabled: settings.loggingEnabled,
    maxRetainedSessionLogs: settings.maxRetainedSessionLogs,
    minRetainedSessionLogsThreshold,
    warnings,
  };
}
