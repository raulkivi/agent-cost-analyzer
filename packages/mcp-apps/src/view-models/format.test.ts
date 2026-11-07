// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { UNKNOWN_TEXT, coverageNote, formatCount, formatDay, formatPercent, formatTokens, measureView, pluralize, valueView } from "./format.js";

describe("formatTokens", () => {
  it("writes small counts in full and larger ones with k and M", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(4200)).toBe("4.2 k");
    expect(formatTokens(9800)).toBe("9.8 k");
    expect(formatTokens(64000)).toBe("64 k");
    expect(formatTokens(310412)).toBe("310 k");
    expect(formatTokens(2_100_000)).toBe("2.1 M");
    expect(formatTokens(1_400_000)).toBe("1.4 M");
  });

  it("moves to M instead of printing 1000 k", () => {
    expect(formatTokens(999_700)).toBe("1 M");
  });
});

describe("formatPercent", () => {
  it("rounds a ratio to a whole percent with a space", () => {
    expect(formatPercent(0.87)).toBe("87 %");
    expect(formatPercent(0)).toBe("0 %");
    expect(formatPercent(1)).toBe("100 %");
  });
});

describe("formatDay", () => {
  it("writes a short UTC month and day", () => {
    expect(formatDay("2026-10-27T23:59:00Z")).toBe("Oct 27");
    expect(formatDay("2026-11-02")).toBe("Nov 2");
  });

  it("returns undefined for a missing or unreadable date", () => {
    expect(formatDay(undefined)).toBeUndefined();
    expect(formatDay("not a date")).toBeUndefined();
  });
});

describe("pluralize and formatCount", () => {
  it("uses the singular for one", () => {
    expect(pluralize(1, "turn")).toBe("1 turn");
    expect(pluralize(42, "turn")).toBe("42 turns");
    expect(pluralize(0, "session")).toBe("0 sessions");
  });

  it("groups thousands", () => {
    expect(formatCount(1234)).toBe("1,234");
  });
});

describe("coverageNote", () => {
  it("names the known and total turns when coverage is partial", () => {
    expect(coverageNote(12, 40)).toBe("known for 12 of 40 turns");
  });

  it("is absent when every turn is known, none is known, or there are no turns", () => {
    expect(coverageNote(40, 40)).toBeUndefined();
    expect(coverageNote(0, 40)).toBeUndefined();
    expect(coverageNote(0, 0)).toBeUndefined();
  });
});

describe("measureView", () => {
  const credits = (value: number) => value.toFixed(2);

  it("shows Unknown for a null total, with no estimate tag", () => {
    expect(measureView({ value: null, knownTurns: 0, turns: 14, estimated: true }, credits)).toEqual({
      text: UNKNOWN_TEXT,
      known: false,
      estimate: false,
    });
  });

  it("shows a known zero as 0, distinct from Unknown", () => {
    expect(measureView({ value: 0, knownTurns: 3, turns: 3, estimated: false }, credits)).toEqual({
      text: "0.00",
      known: true,
      estimate: false,
    });
  });

  it("adds the coverage note and the estimate tag", () => {
    expect(measureView({ value: 18.42, knownTurns: 40, turns: 42, estimated: true }, credits)).toEqual({
      text: "18.42",
      known: true,
      estimate: true,
      coverageNote: "known for 40 of 42 turns",
    });
  });
});

describe("valueView", () => {
  it("treats null and non-finite numbers as Unknown", () => {
    expect(valueView(null, String).text).toBe(UNKNOWN_TEXT);
    expect(valueView(Number.NaN, String).text).toBe(UNKNOWN_TEXT);
    expect(valueView(0, String)).toEqual({ text: "0", known: true, estimate: false });
  });
});
