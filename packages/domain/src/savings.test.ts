// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import * as domain from "./index.js";
import { savingsAmountSchema, savingsOpportunitySchema, savingsReportSchema, type SavingsOpportunity, type SavingsReport } from "./savings.js";

// Phase 16 step SR1 (docs/plans/savings-report.md §5.2, §7): a saving is a
// range or an upper bound (priced) or a Simulated figure, never a bare
// number, and an unknown carries its reason, never 0 (constraint 6).
const known = { known: true, currency: "USD", priceVersionIds: ["anthropic-2026-10-01"] };
const range = { ...known, low: 1.5, high: 4, basis: "priced", label: "range" };
const upperBound = { ...known, low: 0, high: 4, basis: "priced", label: "upper-bound" };
const simulated = { ...known, low: 2, high: 2, basis: "simulated", label: "simulated" };

function opportunity(overrides: Partial<SavingsOpportunity> = {}): SavingsOpportunity {
  return {
    key: "unused-tools:github",
    kind: "unused-tools",
    subject: "github",
    sessions: [{ providerId: "claude-code", sessionId: "s1" }],
    evidence: { sessions: 1, requests: 40, tokens: { known: true, value: 1200, estimated: true }, occurrences: null },
    perWeek: range as SavingsOpportunity["perWeek"],
    perWindow: { ...range, low: 6.4, high: 17.1 } as SavingsOpportunity["perWindow"],
    coverage: { sessionsInWindow: 3, sessionsAnalysed: 2, notAnalysed: [{ reason: "No request trace.", sessions: 1 }] },
    actionParams: { server: "github", tools: 12, tokens: 1200, sessions: 1, days: 30 },
    inferred: false,
    ...overrides,
  };
}

function report(overrides: Partial<SavingsReport> = {}): SavingsReport {
  return {
    window: { since: "2026-10-13", until: "2026-11-12", days: 30 },
    pricing: "as-of-use",
    opportunities: [opportunity()],
    simulated: [],
    notAnalysed: [{ kind: "unused-tools", providerId: "claude-code", reason: "No tool inventory.", sessions: 4 }],
    ...overrides,
  };
}

describe("savingsAmountSchema", () => {
  it("accepts a range", () => {
    expect(savingsAmountSchema.parse(range)).toEqual(range);
  });

  it("accepts an upper bound with no lower bound claimed", () => {
    expect(savingsAmountSchema.parse(upperBound)).toEqual(upperBound);
  });

  it("accepts a simulated amount with its label", () => {
    expect(savingsAmountSchema.parse(simulated)).toEqual(simulated);
  });

  it("accepts an unknown amount with a reason", () => {
    const unknown = { known: false, reason: "No price for the model on that date." };
    expect(savingsAmountSchema.parse(unknown)).toEqual(unknown);
  });

  it("rejects an unknown amount without a reason", () => {
    expect(() => savingsAmountSchema.parse({ known: false })).toThrow();
    expect(() => savingsAmountSchema.parse({ known: false, reason: "" })).toThrow();
  });

  it("rejects low above high", () => {
    expect(() => savingsAmountSchema.parse({ ...range, low: 5, high: 4 })).toThrow(/low/);
  });

  it("rejects a negative amount", () => {
    expect(() => savingsAmountSchema.parse({ ...range, low: -1 })).toThrow();
  });

  it("rejects a simulated basis without the simulated label", () => {
    expect(() => savingsAmountSchema.parse({ ...simulated, label: "range" })).toThrow(/simulated/);
    expect(() => savingsAmountSchema.parse({ ...simulated, label: "upper-bound", low: 0 })).toThrow(/simulated/);
  });

  it("rejects the simulated label on a priced basis", () => {
    expect(() => savingsAmountSchema.parse({ ...range, label: "simulated" })).toThrow(/simulated/);
  });

  it("rejects an upper bound that claims a lower bound", () => {
    expect(() => savingsAmountSchema.parse({ ...upperBound, low: 1 })).toThrow(/upper bound/);
  });

  it("rejects a known amount with no price version", () => {
    expect(() => savingsAmountSchema.parse({ ...range, priceVersionIds: [] })).toThrow();
  });

  it("rejects a currency other than AI Credits or USD", () => {
    expect(() => savingsAmountSchema.parse({ ...range, currency: "EUR" })).toThrow();
  });
});

describe("savingsOpportunitySchema", () => {
  it("accepts a priced opportunity", () => {
    expect(savingsOpportunitySchema.parse(opportunity())).toEqual(opportunity());
  });

  it("accepts unknown amounts with their reasons", () => {
    const unknown = { known: false, reason: "No price for the model on that date." } as const;
    expect(() => savingsOpportunitySchema.parse(opportunity({ perWeek: unknown, perWindow: unknown }))).not.toThrow();
  });

  it("accepts unknown request counts as null, not 0", () => {
    expect(() => savingsOpportunitySchema.parse(opportunity({ evidence: { sessions: 1, requests: null, tokens: null, occurrences: null } }))).not.toThrow();
  });

  it("rejects an unknown kind", () => {
    expect(() => savingsOpportunitySchema.parse({ ...opportunity(), kind: "other" })).toThrow();
  });

  it("rejects a cheaper-model opportunity that is not simulated", () => {
    expect(() => savingsOpportunitySchema.parse(opportunity({ kind: "cheaper-model" }))).toThrow(/simulated/);
  });

  describe("simulation (a cheaper-model replay's self-check, coverage and assumptions)", () => {
    const sim = simulated as SavingsOpportunity["perWeek"];
    const simulation = {
      model: "claude-haiku-5.5",
      selfCheck: { requests: 20, matching: 19, passed: false },
      coverage: { turns: 10, replayedTurns: 9, requests: 20, replayedRequests: 18 },
      assumptions: [{ id: "A1", text: "Same conversation." }],
    };
    const cheaper = (extra: Partial<SavingsOpportunity> = {}) => opportunity({ kind: "cheaper-model", perWeek: sim, perWindow: sim, ...extra });

    it("is carried by a cheaper-model opportunity", () => {
      expect(savingsOpportunitySchema.parse(cheaper({ simulation })).simulation).toEqual(simulation);
    });

    it("is rejected on any other kind", () => {
      expect(() => savingsOpportunitySchema.parse(opportunity({ simulation }))).toThrow(/simulation/);
    });

    it("rejects more matching requests than requests, or more replayed turns than turns", () => {
      expect(() => savingsOpportunitySchema.parse(cheaper({ simulation: { ...simulation, selfCheck: { requests: 2, matching: 3, passed: false } } }))).toThrow();
      expect(() => savingsOpportunitySchema.parse(cheaper({ simulation: { ...simulation, coverage: { ...simulation.coverage, replayedTurns: 11 } } }))).toThrow();
    });
  });

  it("rejects a simulated amount on any other kind", () => {
    const sim = simulated as SavingsOpportunity["perWeek"];
    expect(() => savingsOpportunitySchema.parse(opportunity({ perWeek: sim, perWindow: sim }))).toThrow(/simulated/);
  });

  it("rejects more analysed sessions than sessions in the window", () => {
    expect(() => savingsOpportunitySchema.parse(opportunity({ coverage: { sessionsInWindow: 1, sessionsAnalysed: 2, notAnalysed: [] } }))).toThrow(/sessionsAnalysed/);
  });

  it("rejects an over-long subject", () => {
    expect(() => savingsOpportunitySchema.parse(opportunity({ subject: "x".repeat(200) }))).toThrow();
  });

  it("rejects a non-scalar action parameter", () => {
    expect(() => savingsOpportunitySchema.parse({ ...opportunity(), actionParams: { server: { a: 1 } } })).toThrow();
  });
});

describe("savingsReportSchema", () => {
  it("takes an optional report-level list of sessions left out, and rejects a bad one", () => {
    const leftOut = { providerId: "claude-code", reason: "Over the 2-session cap.", sessions: 2 };
    expect(() => savingsReportSchema.parse(report({ sessionsLeftOut: [leftOut] }))).not.toThrow();
    expect(() => savingsReportSchema.parse(report({ sessionsLeftOut: [{ ...leftOut, sessions: -1 }] }))).toThrow();
    expect(() => savingsReportSchema.parse(report({ sessionsLeftOut: [{ ...leftOut, reason: "" }] }))).toThrow();
  });

  it("accepts a report", () => {
    expect(savingsReportSchema.parse(report())).toEqual(report());
  });

  it("keeps simulated opportunities apart from the ranked list", () => {
    const sim = simulated as SavingsOpportunity["perWeek"];
    const cheaper = opportunity({ key: "cheaper-model:s1", kind: "cheaper-model", perWeek: sim, perWindow: sim });
    expect(() => savingsReportSchema.parse(report({ simulated: [cheaper] }))).not.toThrow();
    expect(() => savingsReportSchema.parse(report({ opportunities: [cheaper] }))).toThrow(/ranked/);
    expect(() => savingsReportSchema.parse(report({ simulated: [opportunity()] }))).toThrow(/simulated/);
  });

  it("has no grand total (D4)", () => {
    expect(Object.keys(savingsReportSchema.parse(report()))).not.toContain("total");
  });

  it("rejects a window of zero days", () => {
    expect(() => savingsReportSchema.parse(report({ window: { since: "2026-11-12", until: "2026-11-12", days: 0 } }))).toThrow();
  });
});

describe("domain index", () => {
  it("exports the savings schemas", () => {
    expect(domain.savingsReportSchema).toBe(savingsReportSchema);
    expect(domain.savingsAmountSchema).toBe(savingsAmountSchema);
  });
});
