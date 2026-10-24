import type { ConfigStatus } from "@copilot-cost-analyzer/domain";
import { describe, expect, it, vi } from "vitest";
import { upperCaseTranslate } from "../l10n/upper-case-translate.js";
import { COMMAND_IDS } from "./command-ids.js";
import { ExtensionCommands } from "./extension-commands.js";

const LOGGING_SETTING = "github.copilot.chat.agentDebugLog.fileLogging.enabled";

function statusWith(...settingIds: string[]): ConfigStatus {
  return {
    checkedAt: "2026-10-24T00:00:00.000Z",
    vscodeUserSettingsPath: null,
    loggingEnabled: false,
    maxRetainedSessionLogs: null,
    minRetainedSessionLogsThreshold: 200,
    warnings: settingIds.map((settingId) => ({
      code: "logging-disabled" as const,
      severity: "required" as const,
      settingId,
      currentValue: false,
      recommendedValue: true,
      message: "m",
      helpSteps: [],
    })),
  };
}

function setup(readConfigStatus: () => Promise<ConfigStatus> = async () => statusWith(LOGGING_SETTING)) {
  const panel = { open: vi.fn(), postWhenReady: vi.fn() };
  const sidebar = { refresh: vi.fn(async () => undefined) };
  const hostCommands = { openSetting: vi.fn(async () => undefined) };
  const walkthrough = { open: vi.fn(async () => undefined) };
  const commands = new ExtensionCommands({ panel, sidebar, hostCommands, walkthrough, readConfigStatus });
  return { commands, panel, sidebar, hostCommands, walkthrough };
}

const selectSession = (payload: unknown) => ({ kind: "event", name: "selectSession", payload });

describe("ExtensionCommands", () => {
  describe("openWalkthrough", () => {
    it("opens the Get Started walkthrough and nothing else", async () => {
      const { commands, walkthrough, panel } = setup();

      await commands.openWalkthrough();

      expect(walkthrough.open).toHaveBeenCalledTimes(1);
      expect(panel.open).not.toHaveBeenCalled();
    });

    it("is registered under its contributed id", () => {
      expect(Object.keys(setup().commands.handlers())).toContain(COMMAND_IDS.openWalkthrough);
    });
  });

  describe("openSession", () => {
    it("opens the panel once and posts selectSession once, after opening", async () => {
      const { commands, panel } = setup();
      const order: string[] = [];
      panel.open.mockImplementation(() => void order.push("open"));
      panel.postWhenReady.mockImplementation(() => void order.push("post"));

      await commands.openSession("s1");

      expect(panel.open).toHaveBeenCalledTimes(1);
      expect(panel.postWhenReady).toHaveBeenCalledTimes(1);
      expect(panel.postWhenReady).toHaveBeenCalledWith(selectSession({ sessionId: "s1" }));
      expect(order).toEqual(["open", "post"]);
    });

    it("takes the session id from a tree node, as VS Code passes the clicked element to menu commands", async () => {
      const { commands, panel } = setup();

      await commands.openSession({ kind: "session", sessionId: "s2", label: "x" });

      expect(panel.postWhenReady).toHaveBeenCalledWith(selectSession({ sessionId: "s2" }));
    });

    it("passes the optional right-panel tab and center view along", async () => {
      const { commands, panel } = setup();

      await commands.openSession("s1", { tab: "tools", view: "session-audit" });

      expect(panel.postWhenReady).toHaveBeenCalledWith(selectSession({ sessionId: "s1", tab: "tools", view: "session-audit" }));
    });

    it("takes only the tab and view from the options, never another session id or the advice dialog", async () => {
      const { commands, panel } = setup();

      await commands.openSession("s1", { sessionId: "other", adviceDialog: true, tab: "tools" });

      expect(panel.postWhenReady).toHaveBeenCalledWith(selectSession({ sessionId: "s1", tab: "tools" }));
    });

    it("rejects, and opens nothing, for a missing or malformed session id, tab or view", async () => {
      const { commands, panel } = setup();

      for (const [target, options] of [
        [undefined, undefined],
        ["", undefined],
        [42, undefined],
        [{ sessionId: 3 }, undefined],
        ["s1", { tab: "settings" }],
        ["s1", { view: "dashboard" }],
      ] as const) {
        await expect(commands.openSession(target, options)).rejects.toThrow(/session/i);
      }
      expect(panel.open).not.toHaveBeenCalled();
      expect(panel.postWhenReady).not.toHaveBeenCalled();
    });
  });

  describe("showToolAudit", () => {
    it("opens the session on its tool audit", async () => {
      const { commands, panel } = setup();

      await commands.showToolAudit({ kind: "session", sessionId: "s1" });

      expect(panel.open).toHaveBeenCalledTimes(1);
      expect(panel.postWhenReady).toHaveBeenCalledWith(selectSession({ sessionId: "s1", view: "session-audit" }));
    });
  });

  describe("copyAdviceBundle", () => {
    it("opens the session with the advice export dialog requested", async () => {
      const { commands, panel } = setup();

      await commands.copyAdviceBundle({ kind: "session", sessionId: "s1" });

      expect(panel.postWhenReady).toHaveBeenCalledWith(selectSession({ sessionId: "s1", adviceDialog: true }));
    });
  });

  describe("fixSetting", () => {
    it("defaults to the debug-logging setting", async () => {
      const { commands, hostCommands } = setup();

      await commands.fixSetting();

      expect(hostCommands.openSetting).toHaveBeenCalledWith(LOGGING_SETTING);
    });

    it("opens the setting a Setup node names", async () => {
      const retention = "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs";
      const { commands, hostCommands } = setup();

      await commands.fixSetting({ kind: "warning", settingId: retention });
      await commands.fixSetting(retention);

      expect(hostCommands.openSetting.mock.calls).toEqual([[retention], [retention]]);
    });

    it("opens a setting only a current warning names, like the webview's openSetting command", async () => {
      const agentTraces = "github.copilot.chat.otel.dbSpanExporter.enabled";
      const { commands, hostCommands } = setup(async () => statusWith(LOGGING_SETTING, agentTraces));

      await commands.fixSetting(agentTraces);

      expect(hostCommands.openSetting).toHaveBeenCalledWith(agentTraces);
    });

    it("rejects any other setting id and opens nothing", async () => {
      const { commands, hostCommands } = setup();

      await expect(commands.fixSetting("terminal.integrated.shellArgs.linux")).rejects.toThrow(/can't be opened/);
      await expect(commands.fixSetting({ settingId: "editor.fontSize" })).rejects.toThrow(/can't be opened/);
      expect(hostCommands.openSetting).not.toHaveBeenCalled();
    });

    it("still opens the two logging settings when the config status can't be read", async () => {
      const { commands, hostCommands } = setup(async () => {
        throw new Error("unreadable");
      });

      await commands.fixSetting(LOGGING_SETTING);

      expect(hostCommands.openSetting).toHaveBeenCalledWith(LOGGING_SETTING);
    });

    it("falls back to the default for an argument that isn't a setting id", async () => {
      const { commands, hostCommands } = setup();

      await commands.fixSetting({ nothing: true });

      expect(hostCommands.openSetting).toHaveBeenCalledWith(LOGGING_SETTING);
    });
  });

  it("refreshes the sidebar", async () => {
    const { commands, sidebar } = setup();

    await commands.refreshSessions();

    expect(sidebar.refresh).toHaveBeenCalledTimes(1);
  });

  it("opens the panel for the analyzer and for Learn mode (the web app starts there)", () => {
    const { commands, panel } = setup();

    commands.open();
    commands.openLearnMode();

    expect(panel.open).toHaveBeenCalledTimes(2);
    expect(panel.postWhenReady).not.toHaveBeenCalled();
  });

  describe("handlers", () => {
    it("has one handler per contributed command id, bound to the instance", async () => {
      const { commands, panel } = setup();

      const handlers = commands.handlers();

      expect(Object.keys(handlers).sort()).toEqual(Object.values(COMMAND_IDS).sort());
      await handlers[COMMAND_IDS.openSession]!("s1");
      expect(panel.postWhenReady).toHaveBeenCalledWith(selectSession({ sessionId: "s1" }));
    });
  });
});

describe("ExtensionCommands error messages (vscode-extension.md §3.5 Localization)", () => {
  it("translates the messages VS Code shows when a command is refused", async () => {
    const panel = { open: vi.fn(), postWhenReady: vi.fn() };
    const commands = new ExtensionCommands({
      panel,
      sidebar: { refresh: async () => undefined },
      hostCommands: { openSetting: async () => undefined },
      walkthrough: { open: async () => undefined },
      readConfigStatus: async () => statusWith(LOGGING_SETTING),
      t: upperCaseTranslate,
    });

    await expect(commands.openSession(42)).rejects.toThrow("A SESSION ID IS NEEDED TO OPEN A SESSION, WITH AN OPTIONAL TAB OR VIEW");
    await expect(commands.fixSetting("editor.fontSize")).rejects.toThrow(`SETTING "editor.fontSize" CAN'T BE OPENED FROM THE ANALYZER`);
  });
});
