// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { monthlyAllowanceAnswerSchema, type AllowanceSettings, type CopilotHarness, type Session } from "@agent-cost-analyzer/domain";
import type { AllowanceSettingsStore } from "./allowance-settings-store.js";
import { MonthlyAllowanceService, type CopilotSessionSource } from "./monthly-allowance-service.js";

// MS5 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/monthly-allowance-standalone.md §10, 1.0 criterion C9): the service
// over 5,000 session summaries stays inside the extension's 50 ms budget
// (MA8), so it needs no memo: one listSessions per request, no cache.
const BUDGET_MS = 50;
const NOW = new Date("2026-10-24T15:00:00Z");
const ZONE = "Europe/Tallinn"; // a DST zone: the slow Intl path, not UTC
const SETTINGS: AllowanceSettings = { aiCredits: 1000, resetDay: 1, warnAtPercent: 80 };
// Best of a few runs: the budget is about the code, not a busy CI worker.
const ATTEMPTS = 3;

// Mixed harnesses and costs (known, unknown, estimated), spread across
// 2026-01-01 to 2026-10-24 so the period start (2026-10-01) splits them.
function sessions(count: number): Session[] {
  const first = Date.parse("2026-01-01T00:00:00Z");
  const span = Date.parse("2026-10-24T00:00:00Z") - first;
  const harnesses: (CopilotHarness | undefined)[] = ["local", "agent-host", undefined];
  return Array.from({ length: count }, (_, index) => {
    const costAiCredits: Session["costAiCredits"] =
      index % 10 === 0 ? { known: false, reason: "x" } : index % 7 === 0 ? { known: true, value: 0.5, estimated: true } : { known: true, value: 0.5 };
    const harness = harnesses[index % harnesses.length];
    return {
      id: `s${index}`,
      mode: "analyze",
      providerId: "vscode",
      title: `s${index}`,
      model: "m",
      turns: [],
      turnCount: 1,
      costAiCredits,
      usageDataAvailable: true,
      startedAt: new Date(first + Math.floor((index / count) * span)).toISOString(),
      ...(harness ? { copilotHarness: harness } : {}),
    };
  });
}

class MemoryStore implements AllowanceSettingsStore {
  read() {
    return SETTINGS;
  }
  write() {}
}

function service(list: Session[], calls: { list: number }) {
  const copilot: CopilotSessionSource = {
    async checkAvailability() {
      return { available: true };
    },
    async listSessions() {
      calls.list += 1;
      return list;
    },
  };
  return new MonthlyAllowanceService({ settings: new MemoryStore(), copilot, now: () => NOW, timeZone: ZONE, variant: "VS Code" });
}

describe("monthly allowance service performance (MS5)", () => {
  it(`answers over 5,000 summaries within ${BUDGET_MS} ms, with one listSessions per request`, async () => {
    const calls = { list: 0 };
    // The listing is a fake, so the time is the computation alone.
    const subject = service(sessions(5000), calls);
    let answer = await subject.get(); // warm-up: JIT and the Intl formatter
    const runs: number[] = [];
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const start = performance.now();
      answer = await subject.get();
      runs.push(performance.now() - start);
    }
    const elapsed = Math.min(...runs);

    const parsed = monthlyAllowanceAnswerSchema.parse(answer);
    expect(parsed.state).toBe("known");
    expect(parsed.source.byHarness.map((part) => part.harness).sort()).toEqual(["agent-host", "local"]);
    expect(calls.list).toBe(ATTEMPTS + 1);
    console.info(`MonthlyAllowanceService.get(), 5,000 summaries: ${elapsed.toFixed(2)} ms (budget ${BUDGET_MS} ms; runs ${runs.map((run) => run.toFixed(2)).join(", ")})`);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
