import type { ConfigStatus, ConfigWarning, Session } from "@agent-cost-analyzer/domain";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExtensionApiService } from "@agent-cost-analyzer/server/src/composition/create-extension-api-service";
import {
  AGENT_HOST_FIXTURE_SESSION_IDS,
  readAgentHostFixtureRows,
  sessionRowsWithUsageOnly,
  writeAgentHostCatalog,
  writeAgentSessionDb,
} from "@agent-cost-analyzer/server/src/test-support/agent-host-user-data-dir";
import { InMemoryAppSettingsStore } from "@agent-cost-analyzer/server/src/test-support/in-memory-app-settings-store";
import { copilotLogPathsFromUserDataDir } from "../platform/copilot-log-paths.js";
import { upperCaseTranslate } from "../l10n/upper-case-translate.js";
import { SidebarController, type SidebarSources } from "./sidebar-controller.js";

const NOW = new Date("2026-10-24T15:00:00Z");

function session(id: string, cost: number | null = 1): Session {
  return {
    id,
    mode: "analyze",
    title: id,
    model: "claude-sonnet-5",
    turns: [],
    turnCount: 1,
    costAiCredits: cost === null ? { known: false, reason: "x" } : { known: true, value: cost },
    usageDataAvailable: true,
    startedAt: "2026-10-24T09:00:00Z",
  };
}

function warning(severity: "required" | "optional"): ConfigWarning {
  return {
    code: "logging-disabled",
    severity,
    settingId: "github.copilot.chat.agentDebugLog.fileLogging.enabled",
    currentValue: false,
    recommendedValue: true,
    message: "Debug logging is off.",
    helpSteps: [],
  };
}

function status(warnings: ConfigWarning[]): ConfigStatus {
  return {
    checkedAt: "2026-10-24T00:00:00.000Z",
    vscodeUserSettingsPath: null,
    loggingEnabled: warnings.length === 0,
    maxRetainedSessionLogs: 200,
    minRetainedSessionLogsThreshold: 200,
    warnings,
  };
}

function setup(overrides: Partial<SidebarSources> = {}) {
  const calls: string[] = [];
  const sources: SidebarSources = {
    relistLogSources: vi.fn(() => void calls.push("relist")),
    listSessions: vi.fn(async () => {
      calls.push("listSessions");
      return [session("a", 4), session("b", null)];
    }),
    getConfigStatus: vi.fn(async () => status([])),
    listLearnScenarios: vi.fn(async () => [{ ...session("cache-basics"), mode: "learn" as const, category: "Prompt caching" }]),
    ...overrides,
  };
  const onInternalError = vi.fn();
  const controller = new SidebarController(sources, { now: () => NOW, timeZone: "UTC", onInternalError });
  const onChange = vi.fn();
  controller.onDidChange(onChange);
  return { controller, sources, calls, onChange, onInternalError };
}

describe("SidebarController", () => {
  it("shows nothing until the first refresh", () => {
    const { controller } = setup();

    expect(controller.sessionsTree()).toEqual([]);
    expect(controller.setupTree()).toEqual([]);
    expect(controller.statusBar()).toBeUndefined();
  });

  it("feeds the sessions tree, the setup tree and the status bar from one refresh, announcing it once", async () => {
    const { controller, onChange } = setup({ getConfigStatus: async () => status([warning("optional")]) });

    await controller.refresh();

    expect(controller.sessionsTree().map((group) => group.kind === "group" && group.label)).toEqual(["Today"]);
    expect(controller.setupTree().map((node) => node.settingId)).toEqual(["github.copilot.chat.agentDebugLog.fileLogging.enabled"]);
    expect(controller.statusBar()?.text).toBe("$(graph) 4.00 AI Credits today");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("re-lists the debug-logs folders before it reads the sessions, on every refresh", async () => {
    const { controller, calls } = setup();

    await controller.refresh();
    await controller.refresh();

    expect(calls).toEqual(["relist", "listSessions", "relist", "listSessions"]);
  });

  it("refreshes only the config status on a config change: no re-listing, no session reads", async () => {
    let current = status([]);
    const { controller, sources, onChange } = setup({ getConfigStatus: async () => current });
    await controller.refresh();
    onChange.mockClear();
    vi.mocked(sources.listSessions).mockClear();
    vi.mocked(sources.relistLogSources).mockClear();

    current = status([warning("required")]);
    await controller.refreshConfig();

    expect(sources.listSessions).not.toHaveBeenCalled();
    expect(sources.relistLogSources).not.toHaveBeenCalled();
    expect(controller.setupTree()).toHaveLength(1);
    expect(controller.statusBar()?.text).toBe("$(warning) AI Credits: setup needed");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("shows an error node when the sessions can't be read, while setup still works", async () => {
    const { controller, onInternalError } = setup({
      listSessions: async () => {
        throw new Error("disk on fire");
      },
      getConfigStatus: async () => status([warning("required")]),
    });

    await controller.refresh();

    expect(controller.sessionsTree()).toMatchObject([{ kind: "message", icon: "error" }]);
    expect(controller.setupTree()).toHaveLength(1);
    expect(controller.statusBar()?.text).toBe("$(warning) AI Credits: setup needed");
    expect(onInternalError).toHaveBeenCalledWith("listSessions", expect.objectContaining({ message: "disk on fire" }));
  });

  it("recovers on the next refresh after an error", async () => {
    let fail = true;
    const { controller } = setup({
      listSessions: async () => {
        if (fail) throw new Error("boom");
        return [session("a", 2)];
      },
    });
    await controller.refresh();
    fail = false;

    await controller.refresh();

    expect(controller.sessionsTree()).toMatchObject([{ kind: "group", label: "Today" }]);
  });

  it("shows no setup nodes when the config status can't be read, and still lists sessions", async () => {
    const { controller, onInternalError } = setup({
      getConfigStatus: async () => {
        throw new Error("no settings");
      },
    });

    await controller.refresh();

    expect(controller.setupTree()).toEqual([]);
    expect(controller.statusBar()?.text).toBe("$(graph) 4.00 AI Credits today");
    expect(onInternalError).toHaveBeenCalledWith("getConfigStatus", expect.objectContaining({ message: "no settings" }));
  });

  it("keeps going when re-listing the folders fails", async () => {
    const { controller, onInternalError } = setup({
      relistLogSources: () => {
        throw new Error("EACCES");
      },
    });

    await controller.refresh();

    expect(controller.sessionsTree()).toMatchObject([{ kind: "group" }]);
    expect(onInternalError).toHaveBeenCalledWith("relistLogSources", expect.objectContaining({ message: "EACCES" }));
  });

  it("joins a refresh that is already running instead of reading everything twice", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { controller, sources } = setup({
      listSessions: vi.fn(async () => {
        await gate;
        return [session("a")];
      }),
    });

    const first = controller.refresh();
    const second = controller.refresh();
    release();
    await Promise.all([first, second]);

    expect(sources.listSessions).toHaveBeenCalledTimes(1);
    await controller.refresh();
    expect(sources.listSessions).toHaveBeenCalledTimes(2);
  });

  it("reads 'today' at the time of each query, not of the refresh", async () => {
    let now = NOW;
    const controller = new SidebarController(
      { relistLogSources: () => undefined, listSessions: async () => [session("a", 4)], listLearnScenarios: async () => [], getConfigStatus: async () => status([]) },
      { now: () => now, timeZone: "UTC" },
    );
    await controller.refresh();

    now = new Date("2026-10-25T09:00:00Z");

    expect(controller.statusBar()).toBeUndefined();
    expect(controller.sessionsTree()).toMatchObject([{ label: "Yesterday" }]);
  });

  it("stops announcing to a listener that was disposed", async () => {
    const { controller, onChange } = setup();
    const extra = vi.fn();
    const subscription = controller.onDidChange(extra);
    subscription.dispose();

    await controller.refresh();

    expect(extra).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled();
  });
});

describe("SidebarController translation (vscode-extension.md §3.5 Localization)", () => {
  it("renders the trees and the status bar through the translate function it was given", async () => {
    const controller = new SidebarController(
      {
        relistLogSources: () => undefined,
        listSessions: async () => [session("a", null)],
        listLearnScenarios: async () => [],
        getConfigStatus: async () => status([warning("optional")]),
      },
      { now: () => NOW, timeZone: "UTC", translate: upperCaseTranslate },
    );

    await controller.refresh();

    expect(controller.sessionsTree()[0]).toMatchObject({ label: "TODAY", description: "1 UNKNOWN" });
    expect(controller.setupTree()[0]).toMatchObject({ description: "OPTIONAL" });
    expect(controller.statusBar()?.text).toBe("$(graph) AI CREDITS: UNKNOWN");
  });

  it("translates the load error", async () => {
    const controller = new SidebarController(
      {
        relistLogSources: () => undefined,
        listSessions: async () => {
          throw new Error("boom");
        },
        getConfigStatus: async () => status([]),
        listLearnScenarios: async () => [],
      },
      { now: () => NOW, timeZone: "UTC", translate: upperCaseTranslate, onInternalError: () => undefined },
    );

    await controller.refresh();

    expect(controller.sessionsTree()[0]).toMatchObject({ label: "COULDN'T READ YOUR COPILOT CHAT SESSIONS" });
  });
});

// §3.5 Performance: "Sessions tree in under 500 ms" (step 10.9's budgets).
describe("SidebarController timing", () => {
  function timedSetup(listSessions: SidebarSources["listSessions"]) {
    let clock = 0;
    const sessionsTreeBuilt = vi.fn();
    const controller = new SidebarController(
      {
        relistLogSources: () => void (clock += 5),
        listSessions: async () => {
          clock += 100;
          return listSessions();
        },
        getConfigStatus: async () => status([]),
        listLearnScenarios: async () => [],
      },
      { now: () => NOW, timeZone: "UTC", onInternalError: () => undefined, timing: { now: () => clock, sessionsTreeBuilt } },
    );
    return { controller, sessionsTreeBuilt };
  }

  it("reports how long a full refresh took, from its start to the Sessions tree's nodes being built", async () => {
    const { controller, sessionsTreeBuilt } = timedSetup(async () => [session("a")]);

    await controller.refresh();

    expect(sessionsTreeBuilt).toHaveBeenCalledTimes(1);
    expect(sessionsTreeBuilt).toHaveBeenCalledWith(105);
  });

  it("reports nothing when the sessions couldn't be read, or for a config-only refresh", async () => {
    const { controller, sessionsTreeBuilt } = timedSetup(async () => {
      throw new Error("boom");
    });

    await controller.refresh();
    await controller.refreshConfig();

    expect(sessionsTreeBuilt).not.toHaveBeenCalled();
  });
});

// Step 10.12: the Learn view's scenarios. They ship with the extension and
// never change, so they're read once, not on every refresh.
describe("the Learn tree", () => {
  it("is empty until the first refresh, then lists the scenarios by category", async () => {
    const { controller } = setup();
    expect(controller.learnTree()).toEqual([]);

    await controller.refresh();

    const [group] = controller.learnTree();
    expect(group).toMatchObject({ kind: "category", label: "Prompt caching" });
  });

  it("reads the scenarios once, however often the sidebar refreshes", async () => {
    const { controller, sources } = setup();

    await controller.refresh();
    await controller.refresh();

    expect(sources.listLearnScenarios).toHaveBeenCalledTimes(1);
  });

  it("shows an error, reports it, and tries again on the next refresh when the scenarios can't be read", async () => {
    const failing = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue([]);
    const { controller, onInternalError } = setup({ listLearnScenarios: failing });

    await controller.refresh();
    expect(controller.learnTree()).toMatchObject([{ kind: "message", icon: "error" }]);
    expect(onInternalError).toHaveBeenCalledWith("listLearnScenarios", expect.any(Error));

    await controller.refresh();
    expect(controller.learnTree()).toEqual([]);
    expect(failing).toHaveBeenCalledTimes(2);
  });
});

// Step 10.13: the Sessions view and the status bar over VS Code Agent Host
// sessions, read the way the extension reads them (every path from the
// user-data dir, D4).
describe("SidebarController over VS Code Agent Host sessions", () => {
  let userDataDir: string;

  beforeEach(() => {
    userDataDir = mkdtempSync(path.join(tmpdir(), "sidebar-agent-host-"));
  });
  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("lists a session started today in the Sessions view and counts its AI Credits in the status bar", async () => {
    const catalog = readAgentHostFixtureRows("catalog-rows.json");
    const listed = catalog.sessions_v2.find((row) => row.session_uri === `copilotcli:/${AGENT_HOST_FIXTURE_SESSION_IDS.second}`)!;
    writeAgentHostCatalog(userDataDir, { ...catalog, sessions_v2: [{ ...listed, start_time: Date.parse("2026-10-24T09:00:00Z") }] });
    writeAgentSessionDb(userDataDir, AGENT_HOST_FIXTURE_SESSION_IDS.second, sessionRowsWithUsageOnly());
    const api = createExtensionApiService({
      ...copilotLogPathsFromUserDataDir(userDataDir),
      copilotHome: null,
      appSettings: new InMemoryAppSettingsStore(),
      learnScenariosFixturesDir: path.resolve(import.meta.dirname, "../../../server/fixtures/learn-scenarios"),
      appVersion: "0.1.0-test",
    });
    const { controller } = setup({ listSessions: () => api.listSessions() });

    await controller.refresh();

    const [today] = controller.sessionsTree();
    expect(today).toMatchObject({ kind: "group", label: "Today" });
    expect(today.kind === "group" && today.children.map((node) => node.label)).toEqual(["Example custom title"]);
    expect(controller.statusBar()?.text).toBe("$(graph) 282.98 AI Credits today");
  });
});
