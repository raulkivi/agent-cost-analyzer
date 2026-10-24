import type { SettingsSource } from "../../services/config-check/settings-source.js";
import { JsoncFileSettingsSource } from "./jsonc-file-settings-source.js";

// Deprecated alias, still honored by VS Code (architecture.md §7).
const LOGGING_ENABLED_SETTING_ID =
  "github.copilot.chat.agentDebugLog.fileLogging.enabled";
const LOGGING_ENABLED_SETTING_ID_DEPRECATED =
  "github.copilot.chat.agentDebugLog.enabled";
const MAX_RETAINED_SESSION_LOGS_SETTING_ID =
  "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs";
// Optional, off by default (Phase 8.5) — gates agent-traces.db, the local
// OTel span store that carries cache-write/reasoning tokens main.jsonl can't.
const AGENT_TRACES_ENABLED_SETTING_ID =
  "github.copilot.chat.otel.dbSpanExporter.enabled";

export interface VscodeSettingsSnapshot {
  loggingEnabled: boolean;
  maxRetainedSessionLogs: number | null;
  agentTracesEnabled: boolean;
}

// What the config check judges, from whichever SettingsSource it was given.
export function snapshotFromSettings(settings: SettingsSource): VscodeSettingsSnapshot {
  const loggingEnabled =
    settings.get(LOGGING_ENABLED_SETTING_ID) === true ||
    settings.get(LOGGING_ENABLED_SETTING_ID_DEPRECATED) === true;

  const maxRetainedRaw = settings.get(MAX_RETAINED_SESSION_LOGS_SETTING_ID);
  const maxRetainedSessionLogs =
    typeof maxRetainedRaw === "number" ? maxRetainedRaw : null;

  const agentTracesEnabled = settings.get(AGENT_TRACES_ENABLED_SETTING_ID) === true;

  return { loggingEnabled, maxRetainedSessionLogs, agentTracesEnabled };
}

export function readVscodeSettings(
  settingsPath: string | null,
): VscodeSettingsSnapshot {
  return snapshotFromSettings(new JsoncFileSettingsSource(settingsPath));
}
