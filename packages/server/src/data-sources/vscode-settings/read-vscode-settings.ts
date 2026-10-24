import { readFileSync } from "node:fs";
import { parse as parseJsonc } from "jsonc-parser";

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

const NOT_FOUND_SNAPSHOT: VscodeSettingsSnapshot = {
  loggingEnabled: false,
  maxRetainedSessionLogs: null,
  agentTracesEnabled: false,
};

export function readVscodeSettings(
  settingsPath: string | null,
): VscodeSettingsSnapshot {
  if (!settingsPath) {
    return NOT_FOUND_SNAPSHOT;
  }

  let raw: string;
  try {
    raw = readFileSync(settingsPath, "utf8");
  } catch {
    return NOT_FOUND_SNAPSHOT;
  }

  const settings = (parseJsonc(raw) ?? {}) as Record<string, unknown>;

  const loggingEnabled =
    settings[LOGGING_ENABLED_SETTING_ID] === true ||
    settings[LOGGING_ENABLED_SETTING_ID_DEPRECATED] === true;

  const maxRetainedRaw = settings[MAX_RETAINED_SESSION_LOGS_SETTING_ID];
  const maxRetainedSessionLogs =
    typeof maxRetainedRaw === "number" ? maxRetainedRaw : null;

  const agentTracesEnabled = settings[AGENT_TRACES_ENABLED_SETTING_ID] === true;

  return { loggingEnabled, maxRetainedSessionLogs, agentTracesEnabled };
}
