// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Session } from "@agent-cost-analyzer/domain";
import { describe, expect, it } from "vitest";
import type { AllowanceSettings } from "../settings/allowance-settings.js";
import { SidebarController } from "../sidebar/sidebar-controller.js";
import { registerStatusBar, type StatusBarItemLike, type VscodeStatusBarApi } from "./vscode-status-bar.js";

class FakeThemeColor {
  constructor(readonly id: string) {}
}

class FakeItem implements StatusBarItemLike {
  name: string | undefined;
  id: string | undefined;
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

function setup(sessions: Session[], required: boolean, allowance?: AllowanceSettings) {
  const created: { id?: string; alignment: number; priority?: number; item: FakeItem }[] = [];
  const api: VscodeStatusBarApi = {
    StatusBarAlignment: { Left: 1, Right: 2 },
    ThemeColor: FakeThemeColor,
    window: {
      createStatusBarItem: (...args: [string, number, number?] | [number, number?]) => {
        const [id, alignment, priority] = typeof args[0] === "string" ? (args as [string, number, number?]) : [undefined, ...(args as [number, number?])];
        const item = new FakeItem();
        item.id = id;
        created.push({ id, alignment: alignment as number, priority, item });
        return item;
      },
    },
  };
  const controller = new SidebarController(
    {
      relistLogSources: () => undefined,
      listSessions: async () => sessions,
      listLearnScenarios: async () => [],
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
    { now: () => new Date("2026-10-24T15:00:00Z"), timeZone: "UTC", ...(allowance ? { allowance: () => allowance } : {}) },
  );
  const registration = registerStatusBar(api, controller);
  return { controller, item: created[0]!.item, gauge: created[1]?.item as FakeItem, created, registration };
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

describe("registerStatusBar: the monthly allowance gauge (step 10.21 MA5)", () => {
  const settings = (aiCredits: number | null): AllowanceSettings => ({ aiCredits, resetDay: 1, warnAtPercent: 80 });

  it("creates a second item with its own id, name, left alignment and priority 99, hidden", () => {
    const { created, gauge } = setup([today(4)], false, settings(100));

    expect(created[1]).toMatchObject({ id: "aiCreditsAnalyzer.monthlyAllowance", alignment: 1, priority: 99 });
    expect(gauge.name).toBe("AI Credits Analyzer: Monthly Allowance");
    expect(gauge.visible).toBe(false);
    expect(created[0]?.id).toBeUndefined();
  });

  it("shows the normal level without a background; the click focuses the Sessions view", async () => {
    const { controller, gauge } = setup([today(4)], false, settings(100));

    await controller.refresh();

    expect(gauge).toMatchObject({
      visible: true,
      text: "$(dashboard) 4.00 of 100 AI Credits",
      command: "aiCreditsAnalyzer.sessions.focus",
    });
    expect(gauge.tooltip).toContain("Monthly allowance: 100 AI Credits");
    expect(gauge.accessibilityInformation).toEqual({
      label: "AI Credits this month: 4.00 of 100 allowance, 4 percent, 8 days left, 1 of 1 session this month has cost data. Open Sessions.",
      role: "button",
    });
    expect(gauge.backgroundColor).toBeUndefined();
  });

  it("shows near limit with the warning background, and says it in words", async () => {
    const { controller, gauge } = setup([today(85)], false, settings(100));

    await controller.refresh();

    expect(gauge.text).toBe("$(warning) 85.00 of 100 AI Credits · near limit");
    expect((gauge.backgroundColor as FakeThemeColor).id).toBe("statusBarItem.warningBackground");
    expect(gauge.accessibilityInformation?.label.startsWith("Near limit. ")).toBe(true);
  });

  it("shows over with the error background, and says it in words", async () => {
    const { controller, gauge } = setup([today(120)], false, settings(100));

    await controller.refresh();

    expect(gauge.text).toBe("$(error) 120.00 of 100 AI Credits · over");
    expect((gauge.backgroundColor as FakeThemeColor).id).toBe("statusBarItem.errorBackground");
    expect(gauge.accessibilityInformation?.label.startsWith("Over the allowance. ")).toBe(true);
  });

  it("never relies on colour alone: a background always comes with a level word, icon and label", async () => {
    for (const cost of [4, 85, 120]) {
      const { controller, gauge } = setup([today(cost)], false, settings(100));
      await controller.refresh();

      if (gauge.backgroundColor !== undefined) {
        expect(gauge.text).toMatch(/^\$\((warning|error)\) .*· (near limit|over)$/);
        expect(gauge.accessibilityInformation?.label).toMatch(/^(Near limit|Over the allowance)\. /);
      }
    }
  });

  it("drops the background when the level falls back to normal", async () => {
    const { controller, gauge } = setup([today(85)], false, settings(100));
    await controller.refresh();
    gauge.backgroundColor = new FakeThemeColor("statusBarItem.warningBackground");
    const normal = setup([today(4)], false, settings(100));
    normal.gauge.backgroundColor = new FakeThemeColor("statusBarItem.errorBackground");

    await normal.controller.refresh();

    expect(normal.gauge.backgroundColor).toBeUndefined();
  });

  it("stays hidden without an allowance, and hides when the setting is cleared", async () => {
    const unset = setup([today(4)], false, settings(null));
    await unset.controller.refresh();
    expect(unset.gauge.visible).toBe(false);

    const without = setup([today(4)], false);
    await without.controller.refresh();
    expect(without.gauge.visible).toBe(false);
  });

  it("shows before today's item has anything to say (no session today)", async () => {
    const { controller, item, gauge } = setup([{ ...today(4), startedAt: "2026-10-02T09:00:00Z" }], false, settings(100));

    await controller.refresh();

    expect(item.visible).toBe(false);
    expect(gauge.visible).toBe(true);
  });

  it("hides while a required-config warning takes over today's item", async () => {
    const { controller, item, gauge } = setup([today(4)], true, settings(100));

    await controller.refresh();

    expect(item.text).toBe("$(warning) AI Credits: setup needed");
    expect(gauge.visible).toBe(false);
  });

  it("re-renders when a setting changes", async () => {
    let credits: number | null = 100;
    const { controller, gauge } = setup([today(85)], false, { get aiCredits() { return credits; }, resetDay: 1, warnAtPercent: 80 });
    await controller.refresh();
    expect(gauge.visible).toBe(true);

    credits = null;
    controller.settingsChanged();

    expect(gauge.visible).toBe(false);
  });

  it("disposes both items", () => {
    const { created, registration } = setup([today(4)], false, settings(100));

    registration.dispose();

    expect(created.map((entry) => entry.item.disposed)).toEqual([true, true]);
  });
});
