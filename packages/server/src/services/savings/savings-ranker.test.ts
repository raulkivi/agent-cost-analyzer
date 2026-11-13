// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { savingsReportSchema, type Currency, type SavingsAmount, type SavingsLeftOut, type SavingsOpportunity } from "@agent-cost-analyzer/domain";
import { WINDOW } from "../../test-support/savings-fakes.js";
import { perWeek } from "./savings-amounts.js";
import { SavingsRanker } from "./savings-ranker.js";

// Phase 16 SR10 (docs/plans/savings-report.md §5.2, D3, D4): the priced
// opportunities ordered by the high end of their window amount ("up to"),
// unknown amounts last; cheaper-model savings in their own unranked section;
// no grand total.

const VERSION = ["anthropic-api:claude-sonnet-5:2026-10-01"];

function amount(low: number, high: number, currency: Currency = "USD", label: "range" | "upper-bound" = "range"): SavingsAmount {
  return { known: true, currency, low: label === "upper-bound" ? 0 : low, high, basis: "priced", label, priceVersionIds: VERSION };
}

function opportunity(key: string, perWindow: SavingsAmount, kind: SavingsOpportunity["kind"] = "unused-tools"): SavingsOpportunity {
  return {
    key,
    kind,
    subject: key,
    sessions: [{ providerId: "claude-code", sessionId: "s1" }],
    evidence: { sessions: 1, requests: 1, tokens: null, occurrences: null },
    perWeek: perWeek(perWindow, WINDOW),
    perWindow,
    coverage: { sessionsInWindow: 1, sessionsAnalysed: 1, notAnalysed: [] },
    actionParams: {},
    inferred: false,
  };
}

function simulated(key: string, saving: number): SavingsOpportunity {
  const perWindow: SavingsAmount = { known: true, currency: "USD", low: saving, high: saving, basis: "simulated", label: "simulated", priceVersionIds: VERSION };
  return {
    ...opportunity(key, perWindow, "cheaper-model"),
    simulation: {
      model: "claude-haiku-5.5",
      selfCheck: { requests: 2, matching: 2, passed: true },
      coverage: { turns: 1, replayedTurns: 1, requests: 2, replayedRequests: 2 },
      assumptions: [{ id: "A1", text: "Same conversation." }],
    },
  };
}

const unknown = (key: string): SavingsOpportunity => opportunity(key, { known: false, reason: "No session could be priced." });

const rank = (results: Parameters<SavingsRanker["rank"]>[0]["results"], leftOut: SavingsLeftOut[] = []) =>
  new SavingsRanker().rank({ window: WINDOW, pricing: "as-of-use", results, leftOut });

describe("SavingsRanker", () => {
  it("orders the priced opportunities by the high end of their window amount, largest first (D3)", () => {
    const report = rank([
      { opportunities: [opportunity("small", amount(0.5, 1)), opportunity("wide", amount(0, 9, "USD", "upper-bound"))], notAnalysed: [] },
      { opportunities: [opportunity("narrow", amount(4, 5), "idle-cache-expiry")], notAnalysed: [] },
    ]);

    expect(report.opportunities.map((o) => o.key)).toEqual(["wide", "narrow", "small"]);
  });

  it("compares AI Credits and USD at the one documented rate (1 AI Credit = $0.01)", () => {
    const report = rank([{ opportunities: [opportunity("credits", amount(0, 300, "AI_CREDITS")), opportunity("dollars", amount(0, 2))], notAnalysed: [] }]);

    // 300 AI Credits = $3 > $2.
    expect(report.opportunities.map((o) => o.key)).toEqual(["credits", "dollars"]);
  });

  it("breaks a tie on the high end by the low end, then by key, so the order is stable", () => {
    const report = rank([{ opportunities: [opportunity("b", amount(1, 5)), opportunity("c", amount(2, 5)), opportunity("a", amount(1, 5))], notAnalysed: [] }]);

    expect(report.opportunities.map((o) => o.key)).toEqual(["c", "a", "b"]);
  });

  it("puts opportunities with an unknown amount last, never as 0", () => {
    const report = rank([{ opportunities: [unknown("u-2"), opportunity("zero", amount(0, 0)), unknown("u-1"), opportunity("one", amount(0, 1))], notAnalysed: [] }]);

    expect(report.opportunities.map((o) => o.key)).toEqual(["one", "zero", "u-1", "u-2"]);
    expect(report.opportunities.at(-1)!.perWindow).toEqual({ known: false, reason: "No session could be priced." });
  });

  it("keeps Simulated opportunities out of the ranked list, in their own section in the detector's order", () => {
    const report = rank([
      { opportunities: [opportunity("priced", amount(0, 1))], notAnalysed: [] },
      { opportunities: [simulated("sim-small", 1), simulated("sim-large", 50)], notAnalysed: [] },
    ]);

    expect(report.opportunities.map((o) => o.key)).toEqual(["priced"]);
    expect(report.simulated.map((o) => o.key)).toEqual(["sim-small", "sim-large"]);
  });

  it("merges every detector's Not analysed list sorted by kind, provider and reason, and lists the sessions the service left out once, sorted by provider and reason", () => {
    const report = rank(
      [
        { opportunities: [], notAnalysed: [{ kind: "failed-tool-calls", providerId: "vscode", reason: "No audit.", sessions: 1 }] },
        {
          opportunities: [],
          notAnalysed: [
            { kind: "unused-tools", providerId: "vscode", reason: "No inventory.", sessions: 2 },
            { kind: "unused-tools", providerId: "claude-code", reason: "No inventory.", sessions: 3 },
          ],
        },
      ],
      [
        { providerId: "vscode", reason: "Unreadable.", sessions: 1 },
        { providerId: "claude-code", reason: "Over the cap.", sessions: 4 },
      ],
    );

    expect(report.notAnalysed.map((row) => [row.kind, row.providerId, row.reason])).toEqual([
      ["unused-tools", "claude-code", "No inventory."],
      ["unused-tools", "vscode", "No inventory."],
      ["failed-tool-calls", "vscode", "No audit."],
    ]);
    expect(report.sessionsLeftOut).toEqual([
      { providerId: "claude-code", reason: "Over the cap.", sessions: 4 },
      { providerId: "vscode", reason: "Unreadable.", sessions: 1 },
    ]);
    expect(savingsReportSchema.parse(report)).toEqual(report);
  });

  it("gives a schema-valid report with its window and pricing mode and no grand total (D4)", () => {
    const report = rank([
      { opportunities: [opportunity("a", amount(1, 2)), unknown("b")], notAnalysed: [{ kind: "unused-tools", providerId: "pi-agent", reason: "No inventory.", sessions: 1 }] },
      { opportunities: [simulated("s", 3)], notAnalysed: [] },
    ]);

    expect(savingsReportSchema.parse(report)).toEqual(report);
    expect(report.window).toEqual(WINDOW);
    expect(report.pricing).toBe("as-of-use");
    expect(Object.keys(report).sort()).toEqual(["notAnalysed", "opportunities", "pricing", "simulated", "window"]);
  });

  it("gives an empty, valid report when nothing was found", () => {
    const report = rank([]);

    expect(report).toEqual({ window: WINDOW, pricing: "as-of-use", opportunities: [], simulated: [], notAnalysed: [] });
    expect(savingsReportSchema.safeParse(report).success).toBe(true);
  });
});
