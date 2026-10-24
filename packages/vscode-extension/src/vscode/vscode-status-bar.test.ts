import type { Session } from "@copilot-cost-analyzer/domain";
import { describe, expect, it } from "vitest";
import { SidebarController } from "../sidebar/sidebar-controller.js";
import { registerStatusBar, type StatusBarItemLike, type VscodeStatusBarApi } from "./vscode-status-bar.js";

class FakeThemeColor {
  constructor(readonly id: string) {}
}

class FakeItem implements StatusBarItemLike {
  text = "";
  tooltip: string | undefined;
  command: string | undefined;
  backgroundColor: unknown;
  accessibilityInformation: { label: string; role?: string } | undefined;
  visible = false;
  disposed = false;
  show(): void {
    this.visible = true;
  }
  hide(): void {
    this.visible = false;
  }
  dispose(): void {
    this.disposed = true;
  }
}

function setup(sessions: Session[], required: boolean) {
  const created: { alignment: number; priority?: number; item: FakeItem }[] = [];
  const api: VscodeStatusBarApi = {
    StatusBarAlignment: { Left: 1, Right: 2 },
    ThemeColor: FakeThemeColor,
    window: {
      createStatusBarItem: (alignment, priority) => {
        const item = new FakeItem();
        created.push({ alignment, priority, item });
        return item;
      },
    },
  };
  const controller = new SidebarController(
    {
      relistLogSources: () => undefined,
      listSessions: async () => sessions,
      getConfigStatus: async () => ({
        checkedAt: "x",
        vscodeUserSettingsPath: null,
        loggingEnabled: !required,
        maxRetainedSessionLogs: 200,
        minRetainedSessionLogsThreshold: 200,
        warnings: required
          ? [
              {
                code: "logging-disabled" as const,
                severity: "required" as const,
                settingId: "s",
                currentValue: false,
                recommendedValue: true,
                message: "Debug logging is off.",
                helpSteps: [],
              },
            ]
          : [],
      }),
    },
    { now: () => new Date("2026-10-24T15:00:00Z"), timeZone: "UTC" },
  );
  const registration = registerStatusBar(api, controller);
  return { controller, item: created[0]!.item, created, registration };
}

const today = (cost: number | null): Session => ({
  id: "a",
  mode: "analyze",
  title: "a",
  model: "m",
  turns: [],
  turnCount: 1,
  costAiCredits: cost === null ? { known: false, reason: "x" } : { known: true, value: cost },
  usageDataAvailable: true,
  startedAt: "2026-10-24T09:00:00Z",
});

describe("registerStatusBar", () => {
  it("creates the item hidden, on the left", () => {
    const { item, created } = setup([today(4)], false);

    expect(created[0]?.alignment).toBe(1);
    expect(item.visible).toBe(false);
  });

  it("shows today's AI Credits after a refresh, clicking opens the analyzer", async () => {
    const { controller, item } = setup([today(4.5)], false);

    await controller.refresh();

    expect(item).toMatchObject({
      visible: true,
      text: "$(graph) 4.50 AI Credits today",
      tooltip: "1 of 1 session today has cost data",
      command: "aiCreditsAnalyzer.open",
      accessibilityInformation: { label: "AI Credits today: 4.50, 1 of 1 session today has cost data. Open analyzer.", role: "button" },
    });
    expect(item.backgroundColor).toBeUndefined();
  });

  it("shows 'setup needed' with the warning background, and opens the Setup view", async () => {
    const { controller, item } = setup([today(4.5)], true);

    await controller.refresh();

    expect(item.text).toBe("$(warning) AI Credits: setup needed");
    expect(item.command).toBe("aiCreditsAnalyzer.setup.focus");
    expect((item.backgroundColor as FakeThemeColor).id).toBe("statusBarItem.warningBackground");
  });

  it("hides again when there is nothing to show", async () => {
    const { controller, item } = setup([], false);
    item.show();

    await controller.refresh();

    expect(item.visible).toBe(false);
  });

  it("drops the warning background once setup is fixed", async () => {
    const { controller, item } = setup([today(4.5)], true);
    await controller.refresh();
    // The item is reused: set it as a warning, then re-render a healthy state.
    expect(item.backgroundColor).toBeDefined();
    const healthy = setup([today(4.5)], false);
    healthy.item.backgroundColor = new FakeThemeColor("statusBarItem.warningBackground");

    await healthy.controller.refresh();

    expect(healthy.item.backgroundColor).toBeUndefined();
  });

  it("disposes the item and stops listening", async () => {
    const { controller, item, registration } = setup([today(4)], false);

    registration.dispose();
    await controller.refresh();

    expect(item.disposed).toBe(true);
    expect(item.visible).toBe(false);
  });
});
