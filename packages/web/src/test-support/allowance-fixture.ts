// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { monthlyAllowanceAnswerSchema, type MonthlyAllowanceAnswer } from "@agent-cost-analyzer/domain";

// Invented answers of GET /api/monthly-allowance, one per state of
// monthly-allowance-standalone.md §4.6. Each is checked with the domain schema,
// so a fixture that could not come from the server fails here.

const PERIOD = { startKey: "2026-11-01", endKeyExclusive: "2026-12-01", timeZone: "Europe/Tallinn", daysLeft: 12, dayOfPeriod: 19 };
const SETTINGS = { aiCredits: 1000, resetDay: 1, warnAtPercent: 80 };
const AS_OF = "2026-11-19T10:00:00.000Z";

type Source = MonthlyAllowanceAnswer["source"];
type Known = {
  level: "normal" | "near" | "over";
  used: number;
  atLeast: boolean;
  percent: number;
  remaining: number;
  coverage: { known: number; total: number };
  countedSinceKey: string;
};

const source = (byHarness: Source["byHarness"], overrides: Partial<Source> = {}): Source => ({
  providerId: "vscode",
  available: true,
  variant: "VS Code Insiders",
  byHarness,
  ...overrides,
});

function parsed(answer: unknown): MonthlyAllowanceAnswer {
  return monthlyAllowanceAnswerSchema.parse(answer);
}

export const notSetAnswer = (): MonthlyAllowanceAnswer =>
  parsed({ settings: { aiCredits: null, resetDay: 1, warnAtPercent: 80 }, state: "not-set", period: PERIOD, source: source([]), asOf: AS_OF });

export const noSourceAnswer = (): MonthlyAllowanceAnswer =>
  parsed({
    settings: SETTINGS,
    state: "no-source",
    period: PERIOD,
    source: source([], { available: false, reason: "No Copilot Chat logs found", variant: null }),
    asOf: AS_OF,
  });

export const noSessionsAnswer = (): MonthlyAllowanceAnswer =>
  parsed({ settings: SETTINGS, state: "no-sessions", period: PERIOD, figures: { coverage: { known: 0, total: 0 } }, source: source([]), asOf: AS_OF });

export const unknownAnswer = (): MonthlyAllowanceAnswer =>
  parsed({
    settings: SETTINGS,
    state: "unknown",
    period: PERIOD,
    figures: { coverage: { known: 0, total: 9 }, countedSinceKey: "2026-11-02" },
    source: source([
      { harness: "local", known: 0, total: 6, used: null },
      { harness: "agent-host", known: 0, total: 3, used: null },
    ]),
    asOf: AS_OF,
  });

const cents = (n: number) => Math.round(n * 100) / 100;

// Known figures, split 14/6 style between the two harnesses; `agentHost` false
// leaves the second harness out, as the server does when it has no sessions.
export function knownAnswer(figures: Partial<Known> = {}, options: { agentHost?: boolean; settings?: Partial<MonthlyAllowanceAnswer["settings"]> } = {}): MonthlyAllowanceAnswer {
  const full: Known = {
    level: "normal",
    used: 312.4,
    atLeast: false,
    percent: 31,
    remaining: 687.6,
    coverage: { known: 20, total: 20 },
    countedSinceKey: "2026-11-01",
    ...figures,
  };
  const { agentHost = true, settings = {} } = options;
  const { known, total } = full.coverage;
  const hostKnown = agentHost ? Math.floor(known / 3) : 0;
  const hostTotal = agentHost ? Math.floor(total / 3) : 0;
  const harnesses: Source["byHarness"] = [{ harness: "local", known: known - hostKnown, total: total - hostTotal, used: cents(full.used * (agentHost ? 0.7 : 1)) }];
  if (agentHost) harnesses.push({ harness: "agent-host", known: hostKnown, total: hostTotal, used: cents(full.used * 0.3) });
  return parsed({ settings: { ...SETTINGS, ...settings }, state: "known", period: PERIOD, figures: full, source: source(harnesses), asOf: AS_OF });
}

export const nearAnswer = () => knownAnswer({ level: "near", used: 812.4, percent: 81, remaining: 187.6 });
export const overAnswer = () => knownAnswer({ level: "over", used: 1042.1, percent: 104, remaining: 0 }, { agentHost: false });
export const atLeastNearAnswer = () =>
  knownAnswer({ level: "near", used: 812.4, percent: 81, remaining: 187.6, atLeast: true, coverage: { known: 13, total: 20 } });
