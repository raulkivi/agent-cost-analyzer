// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { MAX_SAVINGS_NAME_LENGTH, savingsActionText, type SavingsActionParams, type SavingsAmount, type SavingsOpportunityKind } from "@agent-cost-analyzer/domain";
import { upTo, CLAUDE_IDLE, FAILED_CALLS, IDLE_CACHE, makeSavingsReport, SIMULATED, UNPRICED_ROW, UNUSED_TOOLS, range, UNPRICED } from "../../test-support/savings-fixture.js";
import { actionTextOf, amountText, barSegments, copyableText, coverageText, groupByCurrency, KIND_TITLES, notPricedReasons, perSessionText, sessionDateText, sessionSavingText, windowAmountText } from "./savings-view.js";

describe("amountText (plan §7: a range or an upper bound, never a bare number)", () => {
  it("writes a range with both ends and the unit", () => {
    expect(amountText(range(6.2, 38.4))).toBe("6.2–38.4 AI Credits per week");
  });

  it("writes an upper bound as 'up to', in dollars with two decimals", () => {
    expect(amountText(CLAUDE_IDLE.perWeek)).toBe("up to $3.20 per week");
    expect(amountText(IDLE_CACHE.perWeek)).toBe("up to 46.0 AI Credits per week");
  });

  it("groups thousands", () => {
    expect(amountText(range(1200.5, 3400))).toBe("1,200.5–3,400.0 AI Credits per week");
  });

  it("says 'Not priced' with the reason for an unknown amount, never 0", () => {
    expect(amountText(UNPRICED)).toBe("Not priced");
  });

  it("says 'under' when a known amount's high end rounds to zero, never 0.0–0.0", () => {
    expect(amountText(range(0.001, 0.04))).toBe("under 0.1 AI Credits per week");
    expect(amountText(range(0, 0))).toBe("under 0.1 AI Credits per week");
    expect(amountText(upTo(0.04))).toBe("under 0.1 AI Credits per week");
    expect(amountText(range(0.001, 0.004, "USD"))).toBe("under $0.01 per week");
    expect(amountText(upTo(0.004, "USD"))).toBe("under $0.01 per week");
  });

  it("keeps a range whose low end rounds to zero but high end does not", () => {
    expect(amountText(range(0.01, 3.2))).toBe("0.0–3.2 AI Credits per week");
    expect(amountText(range(0.05, 0.05))).toBe("0.1–0.1 AI Credits per week");
    expect(amountText(range(0.001, 0.01, "USD"))).toBe("$0.00–$0.01 per week");
  });
});

describe("windowAmountText", () => {
  it("says no lower bound is claimed for an upper bound", () => {
    expect(windowAmountText(FAILED_CALLS.perWindow, 30)).toBe("No lower bound is claimed. Over the 30 days: up to 42.1 AI Credits.");
  });

  it("gives the range over the window", () => {
    expect(windowAmountText(UNUSED_TOOLS.perWindow, 30)).toBe("Over the 30 days: 26.7–165.1 AI Credits.");
  });

  it("is empty for an unknown amount", () => {
    expect(windowAmountText(UNPRICED, 30)).toBe("");
  });

  it("says 'under' when the high end rounds to zero", () => {
    expect(windowAmountText(range(0.001, 0.02), 91)).toBe("Over the 91 days: under 0.1 AI Credits.");
    expect(windowAmountText(upTo(0.002, "USD"), 91)).toBe("No lower bound is claimed. Over the 91 days: under $0.01.");
  });
});

describe("perSessionText (a Simulated amount per replayed session)", () => {
  it("divides the window amount by the sessions replayed", () => {
    expect(perSessionText(SIMULATED)).toBe("2.7–3.1 AI Credits per session (5 sessions)");
  });

  it("says 'under' when the per-session high end rounds to zero", () => {
    expect(perSessionText({ ...SIMULATED, perWindow: range(0.01, 0.2) })).toBe("under 0.1 AI Credits per session (5 sessions)");
  });

  it("is empty when no session was replayed or the amount is unknown", () => {
    expect(perSessionText({ ...SIMULATED, evidence: { ...SIMULATED.evidence, sessions: 0 } })).toBe("");
    expect(perSessionText({ ...SIMULATED, perWindow: UNPRICED })).toBe("");
  });
});

// V24 (savings-increment-3.md §4, §10; boards Detail, States): each session's
// date and saving over the window, with the row's label, never a bare number.
describe("sessionDateText", () => {
  it("writes the day in the viewer's time zone, without the year", () => {
    expect(sessionDateText("2026-11-11T12:00:00.000Z", "UTC")).toBe("Nov 11");
    expect(sessionDateText("2026-11-06T23:30:00.000Z", "Asia/Tokyo")).toBe("Nov 7");
  });

  it("says 'date unknown' when the log gave no start, never an empty cell", () => {
    expect(sessionDateText(undefined)).toBe("date unknown");
    expect(sessionDateText("not a date")).toBe("date unknown");
  });
});

describe("sessionSavingText", () => {
  const ref = (perWindow?: SavingsAmount) => ({ providerId: "vscode", sessionId: "s", ...(perWindow === undefined ? {} : { perWindow }) });

  it("writes the saving over the window with the row's label and no 'per week'", () => {
    expect(sessionSavingText(ref(range(3.9, 24)))).toBe("3.9–24.0 AI Credits");
    expect(sessionSavingText(ref(upTo(1.2, "USD")))).toBe("up to $1.20");
  });

  it("says 'Not priced' for an unknown saving or none given, never 0", () => {
    expect(sessionSavingText(ref(UNPRICED))).toBe("Not priced");
    expect(sessionSavingText(ref())).toBe("Not priced");
  });
});

describe("notPricedReasons", () => {
  it("lists each distinct reason of an unknown saving once, in order", () => {
    const unknown = (reason: string) => ({ providerId: "p", sessionId: reason, perWindow: { known: false as const, reason } });
    expect(notPricedReasons([unknown("a"), { providerId: "p", sessionId: "k", perWindow: range(1, 2) }, unknown("b"), unknown("a")])).toEqual(["a", "b"]);
    expect(notPricedReasons([{ providerId: "p", sessionId: "k", perWindow: range(1, 2) }])).toEqual([]);
  });
});

describe("coverageText", () => {
  it("states analysed of total and the reason for each gap", () => {
    expect(coverageText(UNUSED_TOOLS.coverage)).toBe("31 of 41 sessions; 10 not analysed: no tool inventory");
    expect(coverageText({ sessionsInWindow: 5, sessionsAnalysed: 5, notAnalysed: [] })).toBe("5 of 5 sessions");
  });
});

describe("barSegments", () => {
  it("scales the solid low end and the hatched remainder to the largest high end of the list", () => {
    expect(barSegments(range(10, 40), 80)).toEqual({ solid: 12.5, hatched: 37.5 });
    expect(barSegments(IDLE_CACHE.perWeek, 46)).toEqual({ solid: 0, hatched: 100 });
  });

  it("has no bar for an unknown amount", () => {
    expect(barSegments(UNPRICED, 80)).toBeNull();
  });
});

describe("groupByCurrency", () => {
  it("makes one list per currency, AI Credits first, keeping each list's order and unpriced rows last", () => {
    const report = makeSavingsReport({ opportunities: [UNPRICED_ROW, CLAUDE_IDLE, IDLE_CACHE, FAILED_CALLS] });

    const groups = groupByCurrency(report.opportunities);

    expect(groups.map((group) => group.currency)).toEqual(["AI_CREDITS", "USD"]);
    expect(groups[0]!.rows.map((row) => row.key)).toEqual(["idle:sonnet", "failed:rg", "failed:git"]);
    expect(groups[0]!.rows.map((row) => row.rank)).toEqual([1, 2, null]);
    expect(groups[1]!.rows.map((row) => row.rank)).toEqual([1]);
    expect(groups[0]!.maxHigh).toBe(46);
  });

  it("puts an unpriced row in the currency of the known rows of its provider", () => {
    const claudeUnpriced = { ...UNPRICED_ROW, key: "x", sessions: [{ providerId: "claude-code", sessionId: "c" }] };

    const groups = groupByCurrency([CLAUDE_IDLE, claudeUnpriced]);

    expect(groups.map((group) => group.currency)).toEqual(["USD"]);
    expect(groups[0]!.rows.map((row) => row.rank)).toEqual([1, null]);
  });

  it("falls back to the channel's usual currency when no row of the provider is priced", () => {
    expect(groupByCurrency([UNPRICED_ROW]).map((group) => group.currency)).toEqual(["AI_CREDITS"]);
    const claudeUnpriced = { ...UNPRICED_ROW, sessions: [{ providerId: "claude-code", sessionId: "c" }] };
    expect(groupByCurrency([claudeUnpriced]).map((group) => group.currency)).toEqual(["USD"]);
  });
});

describe("KIND_TITLES", () => {
  it("names every kind in plain words", () => {
    expect(KIND_TITLES["unused-tools"]).toBe("Tools loaded but never used");
    expect(KIND_TITLES["cheaper-model"]).toBe("A cheaper model");
    expect(Object.keys(KIND_TITLES)).toHaveLength(6);
  });
});

describe("actionTextOf", () => {
  it("fills the fixed template with grouped numbers", () => {
    expect(actionTextOf(UNUSED_TOOLS)).toContain("about 5,400 tokens");
  });

  it("is null when the parameters do not fit the template", () => {
    expect(actionTextOf({ ...UNUSED_TOOLS, actionParams: {} })).toBeNull();
  });
});

describe("copyableText (threat-model §6.1: folded to one line, no control characters, capped)", () => {
  it("folds lines and removes control characters", () => {
    expect(copyableText("one\ntwo\r\n\tthree\u0007\u202E four")).toBe("one two three four");
  });

  it("caps the length", () => {
    expect(copyableText("x".repeat(5000))).toHaveLength(600);
  });

  // SR16: the cap is 600, not the 120 of a copied title (threat-model §6.1),
  // because the text is a fixed template whose names are capped at 80: the
  // longest one a detector can produce fits whole, so Copy never cuts a
  // sentence, and a longer text can only be a bug.
  it("never cuts the longest action text a template can produce", () => {
    const name = "n".repeat(MAX_SAVINGS_NAME_LENGTH);
    const big = 999_999_999_999.9;
    const longest: Record<SavingsOpportunityKind, SavingsActionParams[]> = {
      "unused-tools": [{ group: name, tools: big, tokens: big, sessions: big, days: big }],
      "idle-cache-expiry": [{ breaks: big, minutes: big, tokens: big, extendedMinutes: big }],
      "unexplained-cache-break": [{ breaks: big, tokens: big }],
      "model-switch": [{ times: big, tokens: big }],
      "failed-tool-calls": ["dependency-missing", "permission-denied", "unclassified"].map((category) => ({ name, calls: big, sessions: big, category })),
      "cheaper-model": [{ model: `m${"o".repeat(79)}`, percent: big, matchPercent: big }],
    };

    for (const [kind, cases] of Object.entries(longest) as [SavingsOpportunityKind, SavingsActionParams[]][]) {
      for (const params of cases) {
        const text = savingsActionText(kind, params);
        expect(copyableText(text), kind).toBe(text);
      }
    }
  });
});
