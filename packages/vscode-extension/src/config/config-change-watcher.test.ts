import { describe, expect, it, vi } from "vitest";
import {
  WATCHED_SETTING_IDS,
  watchConfigChanges,
  type ConfigurationChangeEvent,
  type ConfigurationChangeSource,
} from "./config-change-watcher.js";

class FakeWorkspace implements ConfigurationChangeSource {
  readonly listeners = new Set<(event: ConfigurationChangeEvent) => void>();

  onDidChangeConfiguration(listener: (event: ConfigurationChangeEvent) => void) {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  // Fires a change that affects exactly these setting ids (and their parents, as VS Code reports).
  change(...settingIds: string[]): void {
    const affected = (section: string) => settingIds.some((id) => id === section || id.startsWith(section + "."));
    for (const listener of [...this.listeners]) listener({ affectsConfiguration: affected });
  }
}

describe("watchConfigChanges (vscode-extension.md §6 step 10.4)", () => {
  it("watches the two agentDebugLog settings the config check judges", () => {
    expect(WATCHED_SETTING_IDS).toEqual([
      "github.copilot.chat.agentDebugLog.fileLogging.enabled",
      "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs",
    ]);
  });

  it.each(WATCHED_SETTING_IDS)("notifies when %s changes", (settingId) => {
    const workspace = new FakeWorkspace();
    const notify = vi.fn();
    watchConfigChanges(workspace, notify);

    workspace.change(settingId);

    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("notifies once when both change together", () => {
    const workspace = new FakeWorkspace();
    const notify = vi.fn();
    watchConfigChanges(workspace, notify);

    workspace.change(...WATCHED_SETTING_IDS);

    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("ignores changes to other settings, including the unwatched optional one and its siblings", () => {
    const workspace = new FakeWorkspace();
    const notify = vi.fn();
    watchConfigChanges(workspace, notify);

    workspace.change("editor.fontSize");
    workspace.change("github.copilot.chat.otel.dbSpanExporter.enabled");
    workspace.change("github.copilot.chat.agentDebugLog.fileLogging.somethingElse");

    expect(notify).not.toHaveBeenCalled();
  });

  it("stops notifying once disposed", () => {
    const workspace = new FakeWorkspace();
    const notify = vi.fn();
    const subscription = watchConfigChanges(workspace, notify);

    subscription.dispose();
    workspace.change(WATCHED_SETTING_IDS[0]);

    expect(notify).not.toHaveBeenCalled();
    expect(workspace.listeners.size).toBe(0);
  });

  it("keeps listening after notify throws", () => {
    const workspace = new FakeWorkspace();
    const notify = vi.fn(() => {
      throw new Error("panel gone");
    });
    watchConfigChanges(workspace, notify);

    expect(() => workspace.change(WATCHED_SETTING_IDS[0])).not.toThrow();
    workspace.change(WATCHED_SETTING_IDS[0]);
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
