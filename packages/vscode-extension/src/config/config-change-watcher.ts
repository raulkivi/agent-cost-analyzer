import type { Disposable } from "../panel/analyzer-panel.js";

// The slices of vscode.workspace / vscode.ConfigurationChangeEvent the
// watcher needs, so it's testable without VS Code; extension.ts passes the
// real workspace.
export interface ConfigurationChangeEvent {
  affectsConfiguration(section: string): boolean;
}

export interface ConfigurationChangeSource {
  onDidChangeConfiguration(listener: (event: ConfigurationChangeEvent) => void): Disposable;
}

// The slice of `vscode.extensions` the extension watcher needs.
export interface ExtensionsChangeSource {
  onDidChange(listener: () => void): Disposable;
}

// The settings the config check judges and the Fix steps tell the user to
// change (services/config-check). The optional agent-traces setting is left
// out on purpose: it only ever adds a hint, and it's not on the plan's list.
export const WATCHED_SETTING_IDS = [
  "github.copilot.chat.agentDebugLog.fileLogging.enabled",
  "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs",
] as const;

// Calls `notify` once per change that affects either watched setting, so the
// host can tell the webview to re-fetch the config status (the `configChanged`
// event, plan §4). A throwing `notify` doesn't end the subscription.
export function watchConfigChanges(source: ConfigurationChangeSource, notify: () => void): Disposable {
  return source.onDidChangeConfiguration((event) => {
    if (!WATCHED_SETTING_IDS.some((settingId) => event.affectsConfiguration(settingId))) {
      return;
    }
    try {
      notify();
    } catch {
      // The panel may have just been disposed; the next change tries again.
    }
  });
}

// Calls `notify` whenever the set of extensions changes, so enabling or
// disabling GitHub Copilot Chat refreshes the config status without a
// reload. A throwing `notify` doesn't end the subscription.
export function watchExtensionChanges(source: ExtensionsChangeSource, notify: () => void): Disposable {
  return source.onDidChange(() => {
    try {
      notify();
    } catch {
      // The panel may have just been disposed; the next change tries again.
    }
  });
}
