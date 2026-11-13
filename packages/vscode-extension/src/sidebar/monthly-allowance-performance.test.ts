// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ConfigStatus, Session } from "@agent-cost-analyzer/domain";
import { describe, expect, it, vi } from "vitest";
import type { AllowanceSettings } from "../settings/allowance-settings.js";
import { SidebarController, type SidebarSources } from "./sidebar-controller.js";

// Step 10.21 MA8 (plan monthly-allowance.md §3.6): 5,000 session summaries
// stay under 50 ms and a setting change calls no source.
const BUDGET_MS = 50;
const NOW = new Date("2026-10-24T15:00:00Z");
const ZONE = "Europe/Tallinn"; // a DST zone: the slow Intl path, not UTC

function sessions(count: number): Session[] {
  const first = Date.parse("2026-01-01T00:00:00Z");
  const span = Date.parse("2026-10-24T00:00:00Z") - first;
  return Array.from({ length: count }, (_, index) => ({
    id: `s${index}`,
    mode: "analyze",
    title: `s${index}`,
    model: "claude-sonnet-5",
    turns: [],
    turnCount: 1,
    costAiCredits: index % 10 === 0 ? { known: false, reason: "x" } : { known: true, value: 0.5 },
    usageDataAvailable: true,
    startedAt: new Date(first + Math.floor((index / count) * span)).toISOString(),
  }));
}

const status: ConfigStatus = {
  checkedAt: "2026-10-24T00:00:00.000Z",
  vscodeUserSettingsPath: null,
  loggingEnabled: true,
  maxRetainedSessionLogs: 200,
  minRetainedSessionLogsThreshold: 200,
  warnings: [],
};

async function setup(settings: () => AllowanceSettings) {
  const list = sessions(5000);
  const sources: SidebarSources = {
    relistLogSources: vi.fn(),
    listSessions: vi.fn(async () => list),
    getConfigStatus: vi.fn(async () => status),
    listLearnScenarios: vi.fn(async () => []),
  };
  const controller = new SidebarController(sources, { now: () => NOW, timeZone: ZONE, allowance: settings });
  await controller.refresh();
  return { controller, sources };
}

const timed = (work: () => void): number => {
  const start = performance.now();
  work();
  return performance.now() - start;
};

// Best of a few runs: the budget is about the code, not about a CI worker
// that is busy with other test files at that moment.
const ATTEMPTS = 3;

describe("monthly allowance performance (MA8)", () => {
  it(`builds the model for 5,000 summaries within ${BUDGET_MS} ms`, async () => {
    const runs: number[] = [];
    let controller: SidebarController | undefined;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      ({ controller } = await setup(() => ({ aiCredits: 1000, resetDay: 1, warnAtPercent: 80 })));
      const fresh = controller;
      runs.push(timed(() => fresh.monthlyAllowance()));
    }
    const elapsed = Math.min(...runs);

    expect(controller?.monthlyAllowance()).toMatchObject({ level: "normal", coverage: { total: expect.any(Number) } });
    console.info(`monthlyAllowance(), 5,000 summaries, cold: ${elapsed.toFixed(2)} ms (budget ${BUDGET_MS} ms)`);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it("a setting change calls no source and recomputes within the budget", async () => {
    let settings: AllowanceSettings = { aiCredits: 1000, resetDay: 1, warnAtPercent: 80 };
    const { controller, sources } = await setup(() => settings);
    controller.monthlyAllowance();
    const listed = vi.mocked(sources.listSessions).mock.calls.length;
    const relisted = vi.mocked(sources.relistLogSources).mock.calls.length;
    const statusReads = vi.mocked(sources.getConfigStatus).mock.calls.length;

    const runs: number[] = [];
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      // A new reset day each time, so every attempt misses the memo.
      settings = { ...settings, aiCredits: 500, resetDay: 15 + attempt };
      controller.settingsChanged();
      runs.push(timed(() => controller.monthlyAllowance()));
    }
    const elapsed = Math.min(...runs);

    console.info(`monthlyAllowance() after a setting change: ${elapsed.toFixed(2)} ms`);
    expect(elapsed).toBeLessThan(BUDGET_MS);
    expect(sources.listSessions).toHaveBeenCalledTimes(listed);
    expect(sources.relistLogSources).toHaveBeenCalledTimes(relisted);
    expect(sources.getConfigStatus).toHaveBeenCalledTimes(statusReads);
  });

  it("an unchanged render is a memo hit, far under the budget", async () => {
    const { controller } = await setup(() => ({ aiCredits: 1000, resetDay: 1, warnAtPercent: 80 }));
    controller.monthlyAllowance();

    const runs = Array.from({ length: ATTEMPTS }, () => timed(() => controller.monthlyAllowance()));
    expect(Math.min(...runs)).toBeLessThan(5);
  });
});
