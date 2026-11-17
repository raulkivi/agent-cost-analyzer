// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import * as domain from "./index.js";
import { savingsAmountSchema, savingsOpportunitySchema, savingsReportSchema, mergeNotAnalysedReasons, type SavingsOpportunity, type SavingsReport } from "./savings.js";

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

  // SR16, D12: unused-tools tokens come from the local tokenizer, so the
  // "estimate" label can't be dropped.
  it("rejects unused-tools tokens that are not marked as an estimate", () => {
    expect(() => savingsOpportunitySchema.parse(opportunity({ evidence: { sessions: 1, requests: 40, tokens: { known: true, value: 1200 }, occurrences: null } }))).toThrow(/estimate/);
    expect(() => savingsOpportunitySchema.parse(opportunity({ evidence: { sessions: 1, requests: 40, tokens: { known: true, value: 1200, estimated: false }, occurrences: null } }))).toThrow(/estimate/);
  });

  // V26 (savings-increment-3.md §6): per-tool figures on unused-tools rows.
  describe("tools", () => {
    const tool = (name: string, value = 300, sessions = 1) => ({ name, tokens: { known: true as const, value, estimated: true }, sessions });

    it("accepts a per-tool list with its total", () => {
      expect(() => savingsOpportunitySchema.parse(opportunity({ tools: [tool("a"), tool("b")], toolsTotal: 5 }))).not.toThrow();
    });

    it("keeps a row without tools valid (additive)", () => {
      expect(() => savingsOpportunitySchema.parse(opportunity())).not.toThrow();
    });

    it("rejects tools on any other kind", () => {
      expect(() => savingsOpportunitySchema.parse(opportunity({ kind: "model-switch", tools: [tool("a")], toolsTotal: 1 }))).toThrow(/unused-tools/);
    });

    it("rejects more than 20 tools", () => {
      const tools = Array.from({ length: 21 }, (_, index) => tool(`t${index}`));
      expect(() => savingsOpportunitySchema.parse(opportunity({ tools, toolsTotal: 21 }))).toThrow(/20/);
    });

    it("rejects a total below the listed tools, and a list with no total", () => {
      expect(() => savingsOpportunitySchema.parse(opportunity({ tools: [tool("a"), tool("b")], toolsTotal: 1 }))).toThrow(/toolsTotal/);
      expect(() => savingsOpportunitySchema.parse(opportunity({ tools: [tool("a")] }))).toThrow(/toolsTotal/);
    });

    it("rejects a known per-tool token count that is not an estimate", () => {
      expect(() => savingsOpportunitySchema.parse(opportunity({ tools: [{ name: "a", tokens: { known: true, value: 3 }, sessions: 1 }], toolsTotal: 1 }))).toThrow(/estimate/);
    });

    it("accepts an unknown per-tool count with its reason, never 0", () => {
      const unknown = { name: "a", tokens: { known: false as const, reason: "No definition size." }, sessions: 1 };
      expect(() => savingsOpportunitySchema.parse(opportunity({ tools: [unknown], toolsTotal: 1 }))).not.toThrow();
    });

    it("rejects a tool listed in no session, and an over-long name", () => {
      expect(() => savingsOpportunitySchema.parse(opportunity({ tools: [tool("a", 3, 0)], toolsTotal: 1 }))).toThrow();
      expect(() => savingsOpportunitySchema.parse(opportunity({ tools: [tool("x".repeat(81))], toolsTotal: 1 }))).toThrow();
    });
  });

  it("rejects an unknown kind", () => {
    expect(() => savingsOpportunitySchema.parse({ ...opportunity(), kind: "other" })).toThrow();
  });

  it("rejects a cheaper-model opportunity that is not simulated", () => {
    expect(() => savingsOpportunitySchema.parse(opportunity({ kind: "cheaper-model" }))).toThrow(/simulated/);
  });

  // V24 (savings-increment-3.md §4): each session reference carries its date
  // and its own saving over the window, with the row's basis, label and currency.
  describe("session date and saving (V24)", () => {
    const ref = (extra: Record<string, unknown>) => ({ providerId: "claude-code", sessionId: "s1", ...extra });
    const withRefs = (...sessions: Record<string, unknown>[]) => opportunity({ sessions: sessions as SavingsOpportunity["sessions"] });

    it("accepts a session with a start time and a saving", () => {
      const parsed = savingsOpportunitySchema.parse(withRefs(ref({ startedAt: "2026-11-11T09:30:00.000Z", perWindow: { ...range, low: 1, high: 2 } })));
      expect(parsed.sessions[0]).toEqual(ref({ startedAt: "2026-11-11T09:30:00.000Z", perWindow: { ...range, low: 1, high: 2 } }));
    });

    it("keeps both fields optional, so a reference without them still parses", () => {
      expect(() => savingsOpportunitySchema.parse(withRefs(ref({})))).not.toThrow();
    });

    it("rejects a start time that is not an ISO timestamp", () => {
      expect(() => savingsOpportunitySchema.parse(withRefs(ref({ startedAt: "yesterday" })))).toThrow();
    });

    it("accepts an unknown session saving with its reason (never 0)", () => {
      expect(() => savingsOpportunitySchema.parse(withRefs(ref({ perWindow: { known: false, reason: "No price." } })))).not.toThrow();
      expect(() => savingsOpportunitySchema.parse(withRefs(ref({ perWindow: { known: false } })))).toThrow();
    });

    it("rejects a session saving whose label differs from the row's", () => {
      expect(() => savingsOpportunitySchema.parse(withRefs(ref({ perWindow: { ...upperBound, high: 1 } })))).toThrow(/label/);
    });

    it("rejects a session saving whose basis or currency differs from the row's", () => {
      expect(() => savingsOpportunitySchema.parse(withRefs(ref({ perWindow: { ...range, currency: "AI_CREDITS" } })))).toThrow(/currency/);
      expect(() => savingsOpportunitySchema.parse(withRefs(ref({ perWindow: { ...simulated } })))).toThrow(/basis|simulated/);
    });

    it("rejects a known session saving under a row whose amount is unknown", () => {
      const unknown = { known: false, reason: "No price." } as const;
      expect(() => savingsOpportunitySchema.parse({ ...withRefs(ref({ perWindow: range })), perWeek: unknown, perWindow: unknown })).toThrow(/unknown/);
    });
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

    // SR16, plan §7: O6 always carries assumption A1 and the self-check.
    it("is required on a cheaper-model opportunity, with assumption A1 and at least one request compared", () => {
      expect(() => savingsOpportunitySchema.parse(cheaper())).toThrow(/simulation/);
      expect(() => savingsOpportunitySchema.parse(cheaper({ simulation: { ...simulation, assumptions: [] } }))).toThrow(/A1/);
      expect(() => savingsOpportunitySchema.parse(cheaper({ simulation: { ...simulation, selfCheck: { requests: 0, matching: 0, passed: false } } }))).toThrow();
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
    const simulation = {
      model: "claude-haiku-5.5",
      selfCheck: { requests: 20, matching: 19, passed: false },
      coverage: { turns: 10, replayedTurns: 9, requests: 20, replayedRequests: 18 },
      assumptions: [{ id: "A1", text: "Same conversation." }],
    };
    const cheaper = opportunity({ key: "cheaper-model:s1", kind: "cheaper-model", perWeek: sim, perWindow: sim, simulation });
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

// R23, D35 (savings-increment-3.md §17): the tokens of "and N more" are shown
// only when every listed tool was loaded in every session of the row.
describe("unlistedTools", () => {
  const tool = (sessions: number, value = 300) => ({ name: "t", tokens: { known: true as const, value, estimated: true as const }, sessions });
  const total = { known: true as const, value: 1000, estimated: true as const };

  it("gives the row's total less the listed tools when each was loaded in all of the row's sessions", () => {
    expect(domain.unlistedTools([tool(5), tool(5)], 4, total, 5)).toEqual({ count: 2, tokens: 400 });
  });

  it("leaves the tokens out, never 0, when a listed tool was loaded in only some of the sessions", () => {
    expect(domain.unlistedTools([tool(5), tool(4)], 4, total, 5)).toEqual({ count: 2, tokens: null });
  });
});

describe("mergeNotAnalysedReasons", () => {
  it("lists each reason once with the summed count, in the order of first occurrence", () => {
    expect(
      mergeNotAnalysedReasons([
        { reason: "No inventory.", sessions: 5 },
        { reason: "No requests.", sessions: 2 },
        { reason: "No inventory.", sessions: 8 },
      ]),
    ).toEqual([
      { reason: "No inventory.", sessions: 13 },
      { reason: "No requests.", sessions: 2 },
    ]);
  });

  it("leaves distinct reasons and an empty list as they are", () => {
    expect(mergeNotAnalysedReasons([])).toEqual([]);
    expect(mergeNotAnalysedReasons([{ reason: "a", sessions: 1 }, { reason: "b", sessions: 1 }])).toHaveLength(2);
  });
});
