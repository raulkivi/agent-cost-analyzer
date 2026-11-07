// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ConfigStatus, Session } from "@agent-cost-analyzer/domain";
import { describe, expect, it, vi } from "vitest";
import { upperCaseTranslate } from "../l10n/upper-case-translate.js";
import { COMMAND_IDS } from "./command-ids.js";
import { ExtensionCommands } from "./extension-commands.js";
import type { SessionPickItem } from "./session-pick-items.js";

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

function session(overrides: Partial<Session> & { id: string }): Session {
  return {
    mode: "analyze",
    title: overrides.id,
    model: "m",
    turns: [],
    turnCount: 1,
    costAiCredits: { known: true, value: 1 },
    usageDataAvailable: true,
    ...overrides,
  };
}

function setup(readConfigStatus: () => Promise<ConfigStatus> = async () => statusWith(LOGGING_SETTING), sessions: Session[] = []) {
  const panel = { open: vi.fn(), postWhenReady: vi.fn() };
  const sidebar = { refresh: vi.fn(async () => undefined), setSessionsGrouping: vi.fn() };
  const hostCommands = { openSetting: vi.fn(async () => undefined) };
  const walkthrough = { open: vi.fn(async () => undefined) };
  const sessionSource = { list: vi.fn(async () => sessions) };
  const picker = {
    pick: vi.fn<(items: SessionPickItem[], placeholder: string) => Promise<string | undefined>>(async () => undefined),
    inform: vi.fn(),
  };
  const commands = new ExtensionCommands({ panel, sidebar, hostCommands, walkthrough, readConfigStatus, sessions: sessionSource, picker });
  return { commands, panel, sidebar, hostCommands, walkthrough, sessionSource, picker };
}

const selectSession = (payload: unknown) => ({ kind: "event", name: "selectSession", payload });

describe("ExtensionCommands", () => {
  // Step 15.14 (plan §11.9): the Sessions view's grouping toggle.
  describe("groupSessionsByRepository and groupSessionsByDay", () => {
    it("regroup the Sessions view without reading the sessions again", () => {
      const { commands, sidebar } = setup();
      const handlers = commands.handlers();

      handlers[COMMAND_IDS.groupSessionsByRepository]!();
      handlers[COMMAND_IDS.groupSessionsByDay]!();

      expect(sidebar.setSessionsGrouping.mock.calls).toEqual([["repository"], ["day"]]);
      expect(sidebar.refresh).not.toHaveBeenCalled();
    });
  });

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

  // Step 10.12: a click in the Learn view.
  describe("openScenario", () => {
    it("opens the panel and posts selectSession in Learn mode", async () => {
      const { commands, panel } = setup();

      await commands.openScenario("cache-basics");

      expect(panel.open).toHaveBeenCalledTimes(1);
      expect(panel.postWhenReady).toHaveBeenCalledWith(selectSession({ sessionId: "cache-basics", mode: "learn" }));
    });

    it("takes the scenario id from a Learn tree node", async () => {
      const { commands, panel } = setup();

      await commands.openScenario({ kind: "scenario", scenarioId: "ttl", label: "x" });

      expect(panel.postWhenReady).toHaveBeenCalledWith(selectSession({ sessionId: "ttl", mode: "learn" }));
    });

    it("rejects, and opens nothing, without a scenario id", async () => {
      const { commands, panel } = setup();

      for (const target of [undefined, "", 42, { kind: "scenario" }]) {
        await expect(commands.openScenario(target)).rejects.toThrow(/session/i);
      }
      expect(panel.open).not.toHaveBeenCalled();
    });

    it("is registered under its contributed id", () => {
      expect(Object.keys(setup().commands.handlers())).toContain("aiCreditsAnalyzer.openScenario");
    });
  });

  describe("openSession", () => {
    describe("with no session id (the Command Palette)", () => {
      const sessions = [
        session({ id: "old", title: "Old one", startedAt: "2026-11-01T09:00:00Z" }),
        session({ id: "new", title: "New one", startedAt: "2026-11-07T09:00:00Z", costAiCredits: { known: false, reason: "no usage data" } }),
      ];

      it("shows a picker of the sessions, newest first, with Unknown AI Credits worded as such", async () => {
        const { commands, picker, panel } = setup(undefined, sessions);

        await commands.openSession();

        expect(picker.pick).toHaveBeenCalledTimes(1);
        const items = picker.pick.mock.calls[0]![0];
        expect(items.map((item) => item.label)).toEqual(["New one", "Old one"]);
        expect(items[0]!.description).toContain("AI Credits: Unknown");
        expect(items[0]!.detail).toBe("new");
        expect(panel.open).not.toHaveBeenCalled();
      });

      it.each([undefined, null, ""])("treats %j as no session id", async (target) => {
        const { commands, picker } = setup(undefined, sessions);

        await commands.openSession(target);

        expect(picker.pick).toHaveBeenCalledTimes(1);
      });

      it("opens the picked session exactly as an id argument does, keeping the options", async () => {
        const { commands, picker, panel } = setup(undefined, sessions);
        picker.pick.mockResolvedValue("old");

        await commands.openSession(undefined, { tab: "tools" });

        expect(panel.open).toHaveBeenCalledTimes(1);
        expect(panel.postWhenReady).toHaveBeenCalledWith(selectSession({ sessionId: "old", tab: "tools" }));
      });

      it("does nothing when the picker is cancelled", async () => {
        const { commands, picker, panel } = setup(undefined, sessions);
        picker.pick.mockResolvedValue(undefined);

        await commands.openSession();

        expect(panel.open).not.toHaveBeenCalled();
        expect(panel.postWhenReady).not.toHaveBeenCalled();
      });

      it("says there are no sessions, and shows no picker, when the list is empty", async () => {
        const { commands, picker, panel } = setup(undefined, []);

        await commands.openSession();

        expect(picker.pick).not.toHaveBeenCalled();
        expect(picker.inform).toHaveBeenCalledWith("No Copilot Chat sessions were found to open");
        expect(panel.open).not.toHaveBeenCalled();
      });

      it("validates the picked id like any other, rejecting an unusable one", async () => {
        const { commands, picker, panel } = setup(undefined, sessions);
        picker.pick.mockResolvedValue("");

        await expect(commands.openSession()).rejects.toThrow(/session/i);
        expect(panel.open).not.toHaveBeenCalled();
      });

      it("is what the registered handler does with no argument", async () => {
        const { commands, picker } = setup(undefined, sessions);

        await commands.handlers()[COMMAND_IDS.openSession]!();

        expect(picker.pick).toHaveBeenCalledTimes(1);
      });
    });

    it("opens a session id argument directly, without reading the sessions or showing a picker", async () => {
      const { commands, picker, sessionSource, panel } = setup(undefined, [session({ id: "s1" })]);

      await commands.openSession("s1");

      expect(picker.pick).not.toHaveBeenCalled();
      expect(sessionSource.list).not.toHaveBeenCalled();
      expect(panel.postWhenReady).toHaveBeenCalledWith(selectSession({ sessionId: "s1" }));
    });

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
        [42, undefined],
        [{ kind: "session" }, undefined],
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

    it("opens the extension's own MCP setting (the walkthrough's MCP step), even when the config status can't be read", async () => {
      const { commands, hostCommands } = setup(async () => {
        throw new Error("unreadable");
      });

      await commands.fixSetting("aiCreditsAnalyzer.mcp.enabled");

      expect(hostCommands.openSetting).toHaveBeenCalledWith("aiCreditsAnalyzer.mcp.enabled");
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
      sidebar: { refresh: async () => undefined, setSessionsGrouping: () => undefined },
      hostCommands: { openSetting: async () => undefined },
      walkthrough: { open: async () => undefined },
      readConfigStatus: async () => statusWith(LOGGING_SETTING),
      sessions: { list: async () => [] },
      picker: { pick: async () => undefined, inform: () => undefined },
      t: upperCaseTranslate,
    });

    await expect(commands.openSession(42)).rejects.toThrow("A SESSION ID IS NEEDED TO OPEN A SESSION, WITH AN OPTIONAL TAB OR VIEW");
    await expect(commands.fixSetting("editor.fontSize")).rejects.toThrow(`SETTING "editor.fontSize" CAN'T BE OPENED FROM THE ANALYZER`);
  });
});
