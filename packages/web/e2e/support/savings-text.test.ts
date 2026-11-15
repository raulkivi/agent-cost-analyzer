// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { SavingsAmount, SavingsOpportunity } from "@agent-cost-analyzer/domain";
import { expectedAmountText, expectedListName, expectedRow, expectedSessionDate, expectedSessionSaving } from "./savings-text.js";

const known = (over: Partial<Extract<SavingsAmount, { known: true }>>): SavingsAmount => ({
  known: true,
  currency: "USD",
  low: 0,
  high: 3.2,
  basis: "priced",
  label: "upper-bound",
  priceVersionIds: [],
  ...over,
});

describe("expectedAmountText", () => {
  it("writes an upper bound in dollars with two decimals", () => {
    expect(expectedAmountText(known({ high: 3.2 }))).toBe("up to $3.20 per week");
  });

  it("writes a range in AI Credits with one decimal and thousands grouping", () => {
    expect(expectedAmountText(known({ currency: "AI_CREDITS", label: "range", low: 6.24, high: 12345.678 }))).toBe("6.2–12,345.7 AI Credits per week");
  });

  it("says Not priced for an unknown amount", () => {
    expect(expectedAmountText({ known: false, reason: "no price" })).toBe("Not priced");
  });
});

// V24: what each shown session reads in the detail, written out independently of the tab.
describe("expectedSessionSaving and expectedSessionDate", () => {
  it("writes the saving over the window with the row's label and no 'per week'", () => {
    expect(expectedSessionSaving(known({ currency: "AI_CREDITS", label: "range", low: 3.9, high: 24 }))).toBe("3.9–24.0 AI Credits");
    expect(expectedSessionSaving(known({ high: 1.2 }))).toBe("up to $1.20");
  });

  it("says Not priced for an unknown or missing saving", () => {
    expect(expectedSessionSaving({ known: false, reason: "no price" })).toBe("Not priced");
    expect(expectedSessionSaving(undefined)).toBe("Not priced");
  });

  it("writes the UTC day without the year, or 'date unknown'", () => {
    expect(expectedSessionDate("2026-11-11T09:30:00.000Z")).toBe("Nov 11");
    expect(expectedSessionDate("2026-11-06T09:30:00.000Z")).toBe("Nov 6");
    expect(expectedSessionDate(undefined)).toBe("date unknown");
  });
});

describe("expectedRow and expectedListName", () => {
  const opportunity = {
    kind: "model-switch",
    subject: "a to b",
    perWeek: known({}),
    coverage: { sessionsInWindow: 5, sessionsAnalysed: 1, notAnalysed: [{ reason: "No usage records.", sessions: 4 }] },
  } as unknown as SavingsOpportunity;

  it("builds the row's title, subject, amount and coverage", () => {
    expect(expectedRow(opportunity)).toEqual({
      title: "Model switched mid-session",
      subject: "a to b",
      amount: "up to $3.20 per week",
      coverage: "1 of 5 sessions; 4 not analysed: No usage records.",
    });
  });

  it("names the list by currency, and none for an unpriced row", () => {
    expect(expectedListName(opportunity)).toBe("US dollars");
    expect(expectedListName({ ...opportunity, perWeek: { known: false, reason: "x" } } as SavingsOpportunity)).toBeUndefined();
  });
});
