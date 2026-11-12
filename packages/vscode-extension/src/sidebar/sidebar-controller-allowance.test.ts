// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ConfigStatus, Session } from "@agent-cost-analyzer/domain";
import { describe, expect, it, vi } from "vitest";
import type { AllowanceSettings } from "../settings/allowance-settings.js";
import { SidebarController, type SidebarSources } from "./sidebar-controller.js";

const NOW = new Date("2026-10-24T15:00:00Z");
const SET: AllowanceSettings = { aiCredits: 100, resetDay: 1, warnAtPercent: 80 };

function session(id: string, cost: number): Session {
  return {
    id,
    mode: "analyze",
    title: id,
    model: "claude-sonnet-5",
    turns: [],
    turnCount: 1,
    costAiCredits: { known: true, value: cost },
    usageDataAvailable: true,
    startedAt: "2026-10-24T09:00:00Z",
  };
}

const configStatus: ConfigStatus = {
  checkedAt: "2026-10-24T00:00:00.000Z",
  vscodeUserSettingsPath: null,
  loggingEnabled: true,
  maxRetainedSessionLogs: 200,
  minRetainedSessionLogsThreshold: 200,
  warnings: [],
};

function setup(getSettings: () => AllowanceSettings) {
  const sources: SidebarSources = {
    relistLogSources: vi.fn(),
    listSessions: vi.fn(async () => [session("a", 30)]),
    getConfigStatus: vi.fn(async () => configStatus),
    listLearnScenarios: vi.fn(async () => []),
  };
  const onInternalError = vi.fn();
  const controller = new SidebarController(sources, { now: () => NOW, timeZone: "UTC", onInternalError, allowance: getSettings });
  const onChange = vi.fn();
  controller.onDidChange(onChange);
  return { controller, sources, onChange, onInternalError };
}

describe("SidebarController monthly allowance (step 10.21 MA4)", () => {
  it("is hidden until the sessions are read", () => {
    const { controller } = setup(() => SET);

    expect(controller.monthlyAllowance()).toEqual({ level: "hidden" });
  });

  it("is hidden without an allowance getter", async () => {
    const controller = new SidebarController(
      { relistLogSources: vi.fn(), listSessions: async () => [session("a", 30)], getConfigStatus: async () => configStatus, listLearnScenarios: async () => [] },
      { now: () => NOW, timeZone: "UTC" },
    );
    await controller.refresh();

    expect(controller.monthlyAllowance()).toEqual({ level: "hidden" });
  });

  it("builds the model from the read sessions and the settings", async () => {
    const { controller } = setup(() => SET);
    await controller.refresh();

    expect(controller.monthlyAllowance()).toMatchObject({ level: "normal", allowance: 100, used: 30, percent: 30 });
  });

  it("puts the row first in the Sessions tree, in either grouping, and drops it when hidden", async () => {
    let settings: AllowanceSettings = SET;
    const { controller } = setup(() => settings);
    await controller.refresh();

    expect(controller.sessionsTree()[0]).toMatchObject({ kind: "message", id: "monthly-allowance", label: "This month: 30.00 of 100 AI Credits" });
    expect(controller.sessionsTree()[1]?.kind).toBe("group");
    controller.setSessionsGrouping("repository");
    expect(controller.sessionsTree()[0]).toMatchObject({ id: "monthly-allowance" });

    settings = { ...SET, aiCredits: null };
    controller.settingsChanged();
    expect(controller.sessionsTree().every((node) => node.kind === "group")).toBe(true);
  });

  it("memoizes the model while the sessions, the period and the settings are unchanged", async () => {
    const { controller } = setup(() => ({ ...SET }));
    await controller.refresh();

    expect(controller.monthlyAllowance()).toBe(controller.monthlyAllowance());
  });

  it("a setting change re-renders without listing sessions or log folders", async () => {
    let settings = SET;
    const { controller, sources, onChange } = setup(() => settings);
    await controller.refresh();
    const before = controller.monthlyAllowance();
    onChange.mockClear();

    settings = { ...SET, aiCredits: 35 };
    controller.settingsChanged();

    expect(onChange).toHaveBeenCalledTimes(1);
    const after = controller.monthlyAllowance();
    expect(after).not.toBe(before);
    expect(after).toMatchObject({ level: "near", allowance: 35, percent: 85 });
    expect(sources.listSessions).toHaveBeenCalledTimes(1);
    expect(sources.relistLogSources).toHaveBeenCalledTimes(1);
  });

  it("a refresh recomputes from the new sessions", async () => {
    const { controller, sources } = setup(() => SET);
    await controller.refresh();
    const before = controller.monthlyAllowance();
    vi.mocked(sources.listSessions).mockResolvedValue([session("a", 30), session("b", 50)]);

    await controller.refresh();

    const after = controller.monthlyAllowance();
    expect(after).not.toBe(before);
    expect(after).toMatchObject({ used: 80, level: "near" });
  });

  it("a failing getter is logged and hides the gauge", async () => {
    const boom = new Error("settings gone");
    const { controller, onInternalError } = setup(() => {
      throw boom;
    });
    await controller.refresh();

    expect(controller.monthlyAllowance()).toEqual({ level: "hidden" });
    expect(onInternalError).toHaveBeenCalledWith("allowance", boom);
  });

  it("is hidden when the last session read failed", async () => {
    const { controller, sources } = setup(() => SET);
    vi.mocked(sources.listSessions).mockRejectedValue(new Error("x"));
    await controller.refresh();

    expect(controller.monthlyAllowance()).toEqual({ level: "hidden" });
  });
});
