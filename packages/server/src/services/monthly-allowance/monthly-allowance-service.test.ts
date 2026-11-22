// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  monthlyAllowanceAnswerSchema,
  type AllowanceSettings,
  type AllowanceSettingsWrite,
  type CopilotHarness,
  type Session,
  type TokenCount,
} from "@agent-cost-analyzer/domain";
import type { AllowanceSettingsStore } from "./allowance-settings-store.js";
import { MonthlyAllowanceService, NO_COPILOT_LOGS_REASON, variantOfUserDataDir, type CopilotSessionSource } from "./monthly-allowance-service.js";

// https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/monthly-allowance-standalone.md §4.4 to §4.6, MS4: every state of the
// answer, the per-harness split and what the service reads.

const NOW = new Date("2026-11-12T12:00:00Z");
const IN = "2026-11-03T09:00:00Z";
const OLD = "2026-10-20T09:00:00Z";
const SET: AllowanceSettings = { aiCredits: 1000, resetDay: 1, warnAtPercent: 80 };

let nextId = 0;
function session(startedAt: string | undefined, cost: number | null | TokenCount, harness?: CopilotHarness, title = "a session"): Session {
  nextId += 1;
  const costAiCredits: TokenCount = cost === null ? { known: false, reason: "x" } : typeof cost === "number" ? { known: true, value: cost } : cost;
  return { id: `sess${nextId}`, mode: "analyze", providerId: "vscode", title, model: "m", turns: [], turnCount: 1, costAiCredits, usageDataAvailable: true, startedAt, ...(harness ? { copilotHarness: harness } : {}) };
}

class FakeStore implements AllowanceSettingsStore {
  writes: AllowanceSettingsWrite[] = [];
  constructor(public settings: AllowanceSettings = SET) {}
  read() {
    return this.settings;
  }
  write(settings: AllowanceSettingsWrite) {
    this.writes.push(settings);
    this.settings = settings;
  }
}

function build(sessions: Session[], options: { settings?: AllowanceSettings; available?: boolean; variant?: "VS Code" | "VS Code Insiders" | null } = {}) {
  const store = new FakeStore(options.settings);
  const calls = { list: 0 };
  const copilot: CopilotSessionSource = {
    async checkAvailability() {
      return options.available === false ? { available: false, unavailableReason: "No logs." } : { available: true };
    },
    async listSessions() {
      calls.list += 1;
      return sessions;
    },
  };
  const service = new MonthlyAllowanceService({ settings: store, copilot, now: () => NOW, timeZone: "UTC", variant: options.variant === undefined ? "VS Code" : options.variant });
  return { service, store, calls };
}

describe("MonthlyAllowanceService.get", () => {
  it("not-set: no figures, no session read", async () => {
    const { service, calls } = build([session(IN, 5)], { settings: { ...SET, aiCredits: null } });
    const answer = monthlyAllowanceAnswerSchema.parse(await service.get());
    expect(answer).toMatchObject({ state: "not-set", settings: { aiCredits: null }, asOf: NOW.toISOString(), period: { startKey: "2026-11-01", endKeyExclusive: "2026-12-01", timeZone: "UTC", daysLeft: 19, dayOfPeriod: 12 } });
    expect(answer.figures).toBeUndefined();
    expect(calls.list).toBe(0);
  });

  it("no-source: the logs are unavailable, never 0", async () => {
    const { service } = build([], { available: false, variant: null });
    const answer = monthlyAllowanceAnswerSchema.parse(await service.get());
    expect(answer.state).toBe("no-source");
    expect(answer.figures).toBeUndefined();
    expect(answer.source).toEqual({ providerId: "vscode", available: false, reason: "No logs.", variant: null, byHarness: [] });
  });

  it("has a fixed reason for an unavailable source that gives none", () => {
    expect(NO_COPILOT_LOGS_REASON).toBe("No Copilot Chat logs found on this machine");
  });

  it("no-sessions: none in the period (an older one does not count)", async () => {
    const { service } = build([session(OLD, 50)]);
    const answer = monthlyAllowanceAnswerSchema.parse(await service.get());
    expect(answer.state).toBe("no-sessions");
    expect(answer.figures).toEqual({ coverage: { known: 0, total: 0 } });
    expect(answer.source.byHarness).toEqual([]);
  });

  it("unknown: sessions, none with cost data, and an estimate is not billed", async () => {
    const { service } = build([session(IN, null), session("2026-11-05T09:00:00Z", { known: true, value: 9, estimated: true })]);
    const answer = monthlyAllowanceAnswerSchema.parse(await service.get());
    expect(answer.state).toBe("unknown");
    expect(answer.figures).toEqual({ coverage: { known: 0, total: 2 }, countedSinceKey: "2026-11-03" });
    expect(answer.source.byHarness).toEqual([{ harness: "local", known: 0, total: 2, used: null }]);
  });

  it("known: figures, atLeast with a partial sum, level near", async () => {
    const { service } = build([session(IN, 800.5), session("2026-11-04T09:00:00Z", 12.25), session("2026-11-05T09:00:00Z", null)]);
    const answer = monthlyAllowanceAnswerSchema.parse(await service.get());
    expect(answer.state).toBe("known");
    expect(answer.figures).toEqual({ level: "near", used: 812.75, atLeast: true, percent: 81, remaining: 187.25, coverage: { known: 2, total: 3 }, countedSinceKey: "2026-11-03" });
  });

  it("known and complete: atLeast false, level over", async () => {
    const { service } = build([session(IN, 1042.1)]);
    const answer = await service.get();
    expect(answer.figures).toMatchObject({ level: "over", atLeast: false, remaining: 0 });
  });

  it("splits by harness and omits a harness with no session in the period", async () => {
    const { service } = build([session(IN, 10, "local"), session(IN, 5, "agent-host"), session(IN, null, "agent-host"), session(OLD, 99, "agent-host")]);
    const answer = monthlyAllowanceAnswerSchema.parse(await service.get());
    expect(answer.figures).toMatchObject({ used: 15, coverage: { known: 2, total: 3 } });
    expect(answer.source.byHarness).toEqual([
      { harness: "local", known: 1, total: 1, used: 10 },
      { harness: "agent-host", known: 1, total: 2, used: 5 },
    ]);
    const onlyHost = await build([session(IN, 5, "agent-host")]).service.get();
    expect(onlyHost.source.byHarness.map((row) => row.harness)).toEqual(["agent-host"]);
  });

  it("reads the sessions once and names the variant", async () => {
    const { service, calls } = build([session(IN, 1)], { variant: "VS Code Insiders" });
    const answer = await service.get();
    expect(calls.list).toBe(1);
    expect(answer.source).toMatchObject({ providerId: "vscode", available: true, variant: "VS Code Insiders" });
  });

  it("never carries a title, id or path", async () => {
    const { service } = build([session(IN, 5, "local", "SECRET <script>alert(1)</script> /home/x/repo")]);
    const text = JSON.stringify(await service.get());
    expect(text).not.toMatch(/SECRET|script|\/home|sess\d/);
  });
});

describe("MonthlyAllowanceService.save", () => {
  it("writes the settings and answers the fresh figures", async () => {
    const { service, store } = build([session(IN, 300)], { settings: { ...SET, aiCredits: null } });
    const answer = await service.save({ aiCredits: 600, resetDay: 1, warnAtPercent: 50 });
    expect(store.writes).toEqual([{ aiCredits: 600, resetDay: 1, warnAtPercent: 50 }]);
    expect(answer).toMatchObject({ state: "known", settings: { aiCredits: 600, warnAtPercent: 50 }, figures: { level: "near", percent: 50 } });
  });

  it("null removes the allowance and keeps the other two", async () => {
    const { service, store } = build([], { settings: { aiCredits: 5, resetDay: 9, warnAtPercent: 70 } });
    const answer = await service.save({ aiCredits: null, resetDay: 9, warnAtPercent: 70 });
    expect(store.settings).toEqual({ aiCredits: null, resetDay: 9, warnAtPercent: 70 });
    expect(answer.state).toBe("not-set");
  });
});

describe("variantOfUserDataDir", () => {
  it("labels the resolved user-data dir", () => {
    expect(variantOfUserDataDir("/home/u/.config/Code - Insiders")).toBe("VS Code Insiders");
    expect(variantOfUserDataDir("/home/u/.config/Code")).toBe("VS Code");
    expect(variantOfUserDataDir("C:\\Users\\u\\AppData\\Roaming\\Code - Insiders")).toBe("VS Code Insiders");
    expect(variantOfUserDataDir("/tmp/other")).toBeNull();
    expect(variantOfUserDataDir(null)).toBeNull();
  });
});

describe("MonthlyAllowanceService.get reads (MS5)", () => {
  it("lists the sessions once per request, however many harnesses split the answer", async () => {
    const { service, calls } = build([session(IN, 5, "local"), session(IN, 7, "agent-host"), session(IN, 1)]);
    await service.get();
    expect(calls.list).toBe(1);
    await service.get();
    expect(calls.list).toBe(2);
  });

  it("lists nothing when the allowance is not set", async () => {
    const { service, calls } = build([session(IN, 5)], { settings: { ...SET, aiCredits: null } });
    await service.get();
    expect(calls.list).toBe(0);
  });
});
