// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { computeMonthlyAllowance, type AllowanceSettings, type Session, type TokenCount } from "@agent-cost-analyzer/domain";
import { describe, expect, it } from "vitest";
import { buildMonthlyAllowance } from "./monthly-allowance.js";

// MA13 G4: one computation for both products. The extension adds words and
// codicons only; its figures are the domain's, field for field.

function session(startedAt: string, cost: number | null): Session {
  const costAiCredits: TokenCount = cost === null ? { known: false, reason: "x" } : { known: true, value: cost };
  return { id: startedAt, mode: "analyze", title: "t", model: "m", turns: [], turnCount: 1, costAiCredits, usageDataAvailable: true, startedAt };
}

const NOW = new Date("2026-11-12T12:00:00Z");
const SETTINGS: AllowanceSettings = { aiCredits: 1000, resetDay: 1, warnAtPercent: 80 };
const WORDS = ["text", "tooltip", "ariaLabel", "rowLabel", "rowDescription"];

describe("buildMonthlyAllowance: figures from the domain", () => {
  it.each([
    ["known", [session("2026-11-03T09:00:00Z", 300), session("2026-11-10T09:00:00Z", 12.4)], SETTINGS],
    ["at least", [session("2026-11-03T09:00:00Z", 812.4), session("2026-11-10T09:00:00Z", null)], SETTINGS],
    ["unknown", [session("2026-11-03T09:00:00Z", null)], SETTINGS],
    ["no sessions", [session("2026-10-20T09:00:00Z", 40)], SETTINGS],
    ["over, reset day 15", [session("2026-10-20T09:00:00Z", 1042.1)], { ...SETTINGS, resetDay: 15 }],
    ["hidden", [session("2026-11-03T09:00:00Z", 5)], { ...SETTINGS, aiCredits: null }],
  ])("returns the domain's figures unchanged (%s)", (_state, sessions, settings) => {
    const input = { sessions, now: NOW, timeZone: "Europe/Tallinn", settings };
    const figures = Object.fromEntries(Object.entries(buildMonthlyAllowance(input)).filter(([key]) => !WORDS.includes(key)));

    expect(figures).toEqual(computeMonthlyAllowance(input));
  });
});
