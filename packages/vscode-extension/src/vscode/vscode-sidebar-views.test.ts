import type { Session } from "@copilot-cost-analyzer/domain";
import { describe, expect, it, vi } from "vitest";
import { upperCaseTranslate } from "../l10n/upper-case-translate.js";
import { SidebarController } from "../sidebar/sidebar-controller.js";
import { registerLearnView, registerSetupView, registerSessionsView, type VscodeTreeApi, type TreeItemLike } from "./vscode-sidebar-views.js";

class FakeTreeItem implements TreeItemLike {
  description?: string;
  tooltip?: string;
  contextValue?: string;
  iconPath?: unknown;
  id?: string;
  command?: { command: string; title: string; arguments?: unknown[] };
  accessibilityInformation?: { label: string };
  constructor(
    public label: string,
    public collapsibleState: number,
  ) {}
}

class FakeThemeIcon {
  constructor(readonly id: string) {}
}

class FakeEventEmitter<T> {
  private readonly listeners = new Set<(event: T) => void>();
  readonly event = (listener: (event: T) => void) => {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  };
  fire(event: T): void {
    for (const listener of this.listeners) listener(event);
  }
  dispose(): void {
    this.listeners.clear();
  }
}

interface FakeTreeView {
  viewId: string;
  provider: {
    getChildren(element?: unknown): unknown[];
    getTreeItem(element: unknown): FakeTreeItem;
    onDidChangeTreeData: (listener: () => void) => { dispose(): void };
  };
  visibility: FakeEventEmitter<{ visible: boolean }>;
  disposed: boolean;
}

function fakeVscode() {
  const views: FakeTreeView[] = [];
  const api: VscodeTreeApi<FakeTreeItem> = {
    TreeItem: FakeTreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: FakeThemeIcon,
    EventEmitter: FakeEventEmitter,
    window: {
      createTreeView: (viewId, options) => {
        const view: FakeTreeView = {
          viewId,
          provider: options.treeDataProvider as FakeTreeView["provider"],
          visibility: new FakeEventEmitter(),
          disposed: false,
        };
        views.push(view);
        return {
          onDidChangeVisibility: view.visibility.event,
          dispose: () => void (view.disposed = true),
        };
      },
    },
  };
  return { api, views };
}

function session(id: string, cost: number | null): Session {
  return {
    id,
    mode: "analyze",
    title: `Title ${id}`,
    model: "claude-sonnet-5",
    turns: [],
    turnCount: 2,
    costAiCredits: cost === null ? { known: false, reason: "x" } : { known: true, value: cost },
    usageDataAvailable: true,
    startedAt: "2026-10-24T09:00:00Z",
  };
}

function controllerWith(options: { sessions?: Session[]; warnings?: boolean } = {}) {
  const listSessions = vi.fn(async () => options.sessions ?? [session("a", 4.82), session("b", null)]);
  const listLearnScenarios = vi.fn(async (): Promise<Session[]> => [
    { ...session("cache-basics", 0.19), mode: "learn", title: "Cache Basics", category: "Prompt caching", turnCount: 8 },
  ]);
  const getConfigStatus = vi.fn(async () => ({
    checkedAt: "x",
    vscodeUserSettingsPath: null,
    loggingEnabled: !options.warnings,
    maxRetainedSessionLogs: 200,
    minRetainedSessionLogsThreshold: 200,
    warnings: options.warnings
      ? [
          {
            code: "logging-disabled" as const,
            severity: "required" as const,
            settingId: "github.copilot.chat.agentDebugLog.fileLogging.enabled",
            currentValue: false,
            recommendedValue: true,
            message: "Debug logging is off.",
            helpSteps: ["Turn it on"],
          },
        ]
      : [],
  }));
  const controller = new SidebarController(
    { relistLogSources: () => undefined, listSessions, listLearnScenarios, getConfigStatus },
    { now: () => new Date("2026-10-24T15:00:00Z"), timeZone: "UTC" },
  );
  return { controller, listSessions, listLearnScenarios, getConfigStatus };
}

// Step 10.12: the scenarios in the sidebar, like the sessions.
describe("registerLearnView", () => {
  it("registers the Learn view and shows categories, then scenarios that open in Learn mode", async () => {
    const { api, views } = fakeVscode();
    const { controller } = controllerWith();
    registerLearnView(api, controller);
    await controller.refresh();
    const { provider } = views[0]!;

    const [category] = provider.getChildren();
    const [scenario] = provider.getChildren(category);
    const item = provider.getTreeItem(scenario);

    expect(views[0]?.viewId).toBe("aiCreditsAnalyzer.learn");
    expect(provider.getTreeItem(category)).toMatchObject({ label: "Prompt caching", collapsibleState: 2, id: "category:Prompt caching" });
    expect(item).toMatchObject({
      label: "Cache Basics",
      description: "8 turns · 0.19 AI Credits",
      collapsibleState: 0,
      id: "scenario:cache-basics",
      command: { command: "aiCreditsAnalyzer.openScenario", arguments: ["cache-basics"] },
      accessibilityInformation: { label: "Cache Basics, Prompt caching, 8 turns · 0.19 AI Credits" },
    });
    expect((item.iconPath as FakeThemeIcon).id).toBe("mortar-board");
  });

  it("shows the error message node when the scenarios can't be read", async () => {
    const { api, views } = fakeVscode();
    const { controller, listLearnScenarios } = controllerWith();
    listLearnScenarios.mockRejectedValue(new Error("boom"));
    registerLearnView(api, controller);
    await controller.refresh();

    const item = views[0]!.provider.getTreeItem(views[0]!.provider.getChildren()[0]);

    expect(item.label).toBe("Couldn't load the Learn scenarios");
    expect((item.iconPath as FakeThemeIcon).id).toBe("error");
  });
});

describe("registerSessionsView", () => {
  it("registers the Sessions view and shows groups, then sessions, as tree items", async () => {
    const { api, views } = fakeVscode();
    const { controller } = controllerWith();
    registerSessionsView(api, controller);
    await controller.refresh();
    const { provider } = views[0]!;

    const [group] = provider.getChildren();
    const groupItem = provider.getTreeItem(group);
    const [first, second] = provider.getChildren(group);
    const firstItem = provider.getTreeItem(first);

    expect(views[0]?.viewId).toBe("aiCreditsAnalyzer.sessions");
    expect(groupItem).toMatchObject({ label: "Today", description: "4.82 · 1 unknown", collapsibleState: 2, id: "group:2026-10-24" });
    expect(firstItem).toMatchObject({
      label: "Title a",
      description: "4.82",
      collapsibleState: 0,
      id: "session:a",
      contextValue: "aiCreditsAnalyzer.session",
      command: { command: "aiCreditsAnalyzer.openSession", arguments: ["a"] },
      accessibilityInformation: { label: "Title a, 4.82 AI Credits, 2 turns" },
    });
    expect((firstItem.iconPath as FakeThemeIcon).id).toBe("comment-discussion");
    expect(provider.getTreeItem(second).description).toBe("AI Credits unknown");
  });

  it("collapses a group that isn't Today or Yesterday", async () => {
    const { api, views } = fakeVscode();
    const { controller } = controllerWith({ sessions: [{ ...session("a", 1), startedAt: "2026-09-01T09:00:00Z" }] });
    registerSessionsView(api, controller);
    await controller.refresh();

    const [group] = views[0]!.provider.getChildren();

    expect(views[0]!.provider.getTreeItem(group)).toMatchObject({ label: "2026-09-01", collapsibleState: 1 });
  });

  it("shows the error message node with an error icon", async () => {
    const { api, views } = fakeVscode();
    const { controller, listSessions } = controllerWith();
    listSessions.mockRejectedValue(new Error("boom"));
    registerSessionsView(api, controller);
    await controller.refresh();

    const [node] = views[0]!.provider.getChildren();
    const item = views[0]!.provider.getTreeItem(node);

    expect(item.label).toBe("Couldn't read your Copilot Chat sessions");
    expect((item.iconPath as FakeThemeIcon).id).toBe("error");
    expect(item.command).toBeUndefined();
  });

  it("tells VS Code the tree changed when the controller refreshes", async () => {
    const { api, views } = fakeVscode();
    const { controller } = controllerWith();
    registerSessionsView(api, controller);
    const onChange = vi.fn();
    views[0]!.provider.onDidChangeTreeData(onChange);

    await controller.refresh();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("refreshes when the view becomes visible, not when it is hidden", async () => {
    const { api, views } = fakeVscode();
    const { controller, listSessions } = controllerWith();
    registerSessionsView(api, controller);

    views[0]!.visibility.fire({ visible: false });
    expect(listSessions).not.toHaveBeenCalled();
    views[0]!.visibility.fire({ visible: true });

    await vi.waitFor(() => expect(listSessions).toHaveBeenCalledTimes(1));
  });

  it("disposes the view and its subscriptions", () => {
    const { api, views } = fakeVscode();
    const { controller } = controllerWith();

    registerSessionsView(api, controller).dispose();

    expect(views[0]?.disposed).toBe(true);
  });
});

describe("registerSetupView", () => {
  it("registers the Setup view with one item per warning: severity icon, text and the setting to fix", async () => {
    const { api, views } = fakeVscode();
    const { controller } = controllerWith({ warnings: true });
    registerSetupView(api, controller);
    await controller.refresh();
    const { provider } = views[0]!;

    const nodes = provider.getChildren();
    const item = provider.getTreeItem(nodes[0]);

    expect(views[0]?.viewId).toBe("aiCreditsAnalyzer.setup");
    expect(nodes).toHaveLength(1);
    expect(item).toMatchObject({
      label: "Debug logging is off.",
      description: "Required",
      contextValue: "aiCreditsAnalyzer.setupWarning",
      accessibilityInformation: { label: "Required: Debug logging is off." },
    });
    expect((item.iconPath as FakeThemeIcon).id).toBe("warning");
    expect(item.tooltip).toContain("1. Turn it on");
  });

  it("is empty when nothing needs fixing, so the welcome content shows", async () => {
    const { api, views } = fakeVscode();
    const { controller } = controllerWith();
    registerSetupView(api, controller);
    await controller.refresh();

    expect(views[0]!.provider.getChildren()).toEqual([]);
  });

  it("re-reads only the config status when the view becomes visible", async () => {
    const { api, views } = fakeVscode();
    const { controller, listSessions, getConfigStatus } = controllerWith();
    registerSetupView(api, controller);

    views[0]!.visibility.fire({ visible: true });

    await vi.waitFor(() => expect(getConfigStatus).toHaveBeenCalledTimes(1));
    expect(listSessions).not.toHaveBeenCalled();
  });
});

describe("translation of the view items (vscode-extension.md §3.5 Localization)", () => {
  it("titles a session's click command through the translate function", async () => {
    const { api, views } = fakeVscode();
    const { controller } = controllerWith();
    registerSessionsView(api, controller, upperCaseTranslate);
    await controller.refresh();
    const { provider } = views[0]!;
    const [group] = provider.getChildren();
    const [first] = provider.getChildren(group);

    expect(provider.getTreeItem(first).command).toMatchObject({ command: "aiCreditsAnalyzer.openSession", title: "OPEN" });
  });
});
