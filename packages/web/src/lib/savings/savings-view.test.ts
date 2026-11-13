// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { CLAUDE_IDLE, FAILED_CALLS, IDLE_CACHE, makeSavingsReport, SIMULATED, UNPRICED_ROW, UNUSED_TOOLS, range, UNPRICED } from "../../test-support/savings-fixture.js";
import { actionTextOf, amountText, barSegments, copyableText, coverageText, groupByCurrency, KIND_TITLES, perSessionText, windowAmountText } from "./savings-view.js";

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
});

describe("perSessionText (a Simulated amount per replayed session)", () => {
  it("divides the window amount by the sessions replayed", () => {
    expect(perSessionText(SIMULATED)).toBe("2.7–3.1 AI Credits per session (5 sessions)");
  });

  it("is empty when no session was replayed or the amount is unknown", () => {
    expect(perSessionText({ ...SIMULATED, evidence: { ...SIMULATED.evidence, sessions: 0 } })).toBe("");
    expect(perSessionText({ ...SIMULATED, perWindow: UNPRICED })).toBe("");
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
    expect(copyableText("one\ntwo\r\n\tthree\u0007‮ four")).toBe("one two three four");
  });

  it("caps the length", () => {
    expect(copyableText("x".repeat(5000))).toHaveLength(600);
  });
});
