// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import { ALLOWANCE_SETTING_IDS } from "../settings/allowance-settings.js";
import {
  WATCHED_SETTING_IDS,
  watchAllowanceChanges,
  watchConfigChanges,
  watchExtensionChanges,
  type ConfigurationChangeEvent,
  type ConfigurationChangeSource,
  type ExtensionsChangeSource,
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

describe("watchAllowanceChanges (step 10.21 MA4)", () => {
  it.each(Object.values(ALLOWANCE_SETTING_IDS))("notifies when %s changes", (settingId) => {
    const workspace = new FakeWorkspace();
    const notify = vi.fn();
    watchAllowanceChanges(workspace, notify);

    workspace.change(settingId);

    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("notifies once when several allowance settings change together", () => {
    const workspace = new FakeWorkspace();
    const notify = vi.fn();
    watchAllowanceChanges(workspace, notify);

    workspace.change(...Object.values(ALLOWANCE_SETTING_IDS));

    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("ignores other settings, and the Copilot config check ignores the allowance ones", () => {
    const workspace = new FakeWorkspace();
    const allowance = vi.fn();
    const config = vi.fn();
    watchAllowanceChanges(workspace, allowance);
    watchConfigChanges(workspace, config);

    workspace.change("editor.fontSize", WATCHED_SETTING_IDS[0]);
    expect(allowance).not.toHaveBeenCalled();
    workspace.change(ALLOWANCE_SETTING_IDS.aiCredits);

    expect(allowance).toHaveBeenCalledTimes(1);
    expect(config).toHaveBeenCalledTimes(1);
  });

  it("stops once disposed and keeps listening after notify throws", () => {
    const workspace = new FakeWorkspace();
    const notify = vi.fn(() => {
      throw new Error("gone");
    });
    const subscription = watchAllowanceChanges(workspace, notify);

    expect(() => workspace.change(ALLOWANCE_SETTING_IDS.resetDay)).not.toThrow();
    workspace.change(ALLOWANCE_SETTING_IDS.resetDay);
    expect(notify).toHaveBeenCalledTimes(2);
    subscription.dispose();
    expect(workspace.listeners.size).toBe(0);
  });
});

class FakeExtensions implements ExtensionsChangeSource {
  readonly listeners = new Set<() => void>();

  onDidChange(listener: () => void) {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  change(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

describe("watchExtensionChanges", () => {
  // Enabling or disabling GitHub Copilot Chat changes what the config check
  // reports (copilot-chat-unavailable) without touching any setting.
  it("notifies on every change to the set of extensions", () => {
    const extensions = new FakeExtensions();
    const notify = vi.fn();
    watchExtensionChanges(extensions, notify);

    extensions.change();
    extensions.change();

    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("stops notifying once disposed", () => {
    const extensions = new FakeExtensions();
    const notify = vi.fn();
    const subscription = watchExtensionChanges(extensions, notify);

    subscription.dispose();
    extensions.change();

    expect(notify).not.toHaveBeenCalled();
    expect(extensions.listeners.size).toBe(0);
  });

  it("keeps listening after notify throws", () => {
    const extensions = new FakeExtensions();
    const notify = vi.fn(() => {
      throw new Error("panel gone");
    });
    watchExtensionChanges(extensions, notify);

    expect(() => extensions.change()).not.toThrow();
    extensions.change();
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
