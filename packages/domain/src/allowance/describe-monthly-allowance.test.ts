// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { describeMonthlyAllowance, type AllowanceDescription } from "./describe-monthly-allowance.js";
import type { MonthlyAllowanceFigures } from "./monthly-allowance.js";
import { identityTranslate, type Translate } from "./translate.js";

const upper: Translate = (message, ...args) => identityTranslate(message.toUpperCase(), ...args);

const known = (over: Partial<MonthlyAllowanceFigures> = {}): MonthlyAllowanceFigures => ({
  level: "normal",
  allowance: 1000,
  used: 312.4,
  atLeast: false,
  percent: 31,
  remaining: 687.6,
  daysLeft: 12,
  period: { startKey: "2026-11-01", endKeyExclusive: "2026-12-01" },
  coverage: { known: 20, total: 20 },
  countedSinceKey: "2026-11-01",
  ...over,
});
const unknown = known({ used: null, percent: null, remaining: null, coverage: { known: 0, total: 9 } });
const noSessions = known({ used: null, percent: null, remaining: null, coverage: { known: 0, total: 0 }, countedSinceKey: undefined, daysLeft: 1 });

function shown(result: Parameters<typeof describeMonthlyAllowance>[0], options?: Parameters<typeof describeMonthlyAllowance>[1]): AllowanceDescription {
  const described = describeMonthlyAllowance(result, options);
  if (described.state === "hidden") {
    throw new Error("expected a description");
  }
  return described;
}

describe("describeMonthlyAllowance: known", () => {
  it("words a normal month figure-first with no level word", () => {
    const d = shown(known());
    expect(d).toMatchObject({ state: "known", level: "normal", statusLine: "312.40 of 1,000 AI Credits", figure: "312.40 of 1,000 AI Credits" });
    expect(d.levelWord).toBeUndefined();
    expect(d.shortLevelWord).toBeUndefined();
  });

  it("puts the level last in words, with a short form for narrow widths", () => {
    const near = shown(known({ level: "near", used: 812.4, percent: 81 }));
    expect(near.statusLine).toBe("812.40 of 1,000 AI Credits · near limit");
    expect(near.figure).toBe("812.40 of 1,000 AI Credits");
    expect([near.levelWord, near.shortLevelWord]).toEqual(["near limit", "near"]);
    const over = shown(known({ level: "over", used: 1042.1, percent: 104 }));
    expect(over.statusLine).toBe("1,042.10 of 1,000 AI Credits · over");
    expect([over.levelWord, over.shortLevelWord]).toEqual(["over", "over"]);
  });

  it("says at least when some sessions have no cost data", () => {
    const d = shown(known({ level: "near", used: 812.4, percent: 81, atLeast: true, coverage: { known: 13, total: 20 } }));
    expect(d.statusLine).toBe("at least 812.40 of 1,000 AI Credits · near limit");
    expect(d.figure).toBe("at least 812.40 of 1,000 AI Credits");
  });

  it("opens the aria label with the level sentence", () => {
    expect(shown(known()).ariaLabel).toBe("AI Credits this month: 312.40 of 1,000 allowance, 31 percent, 12 days left, 20 of 20 sessions this month have cost data.");
    expect(shown(known({ level: "near", used: 812.4, percent: 81 })).ariaLabel).toMatch(/^Near limit\. AI Credits this month: 812\.40 of 1,000 allowance, 81 percent,/);
    expect(shown(known({ level: "over", used: 1042.1, percent: 104, daysLeft: 26, coverage: { known: 9, total: 9 } })).ariaLabel).toBe(
      "Over the allowance. AI Credits this month: 1,042.10 of 1,000 allowance, 104 percent, 26 days left, 9 of 9 sessions this month have cost data.",
    );
  });

  it("keeps at least in the aria label", () => {
    const d = shown(known({ atLeast: true, coverage: { known: 13, total: 20 } }));
    expect(d.ariaLabel).toBe("AI Credits this month: at least 312.40 of 1,000 allowance, 31 percent, 12 days left, 13 of 20 sessions this month have cost data.");
  });

  it("lists the detail lines in order, with a partial total flagged", () => {
    const d = shown(known({ level: "near", used: 812.4, percent: 81, remaining: 187.6, atLeast: true, coverage: { known: 13, total: 20 }, countedSinceKey: "2026-11-03" }));
    expect(d.detailLines).toEqual([
      "Monthly allowance: 1,000 AI Credits",
      "At least 81 % of the allowance used",
      "Up to 187.60 AI Credits remain",
      "12 days left",
      "Period started 2026-11-01",
      "13 of 20 sessions this month have cost data",
      "Oldest session counted: 2026-11-03",
      "The total may be higher: sessions without cost data are not counted.",
      "Only sessions recorded on this machine are counted.",
    ]);
  });

  it("gives the days left apart for a row", () => {
    expect(shown(known()).daysLeft).toBe("12 days left");
    expect(shown(known({ daysLeft: 1 })).daysLeft).toBe("1 day left");
  });

  it("says no credits remain when over, and uses the singular for one day or session", () => {
    const d = shown(known({ level: "over", used: 1042.1, percent: 104, remaining: 0, daysLeft: 1, coverage: { known: 1, total: 1 } }));
    expect(d.detailLines).toContain("No AI Credits remain");
    expect(d.detailLines).toContain("1 day left");
    expect(d.detailLines).toContain("1 of 1 session this month has cost data");
  });

  it("names the period and zone when the zone is given", () => {
    const d = shown(known(), { timeZone: "Europe/Tallinn" });
    expect(d.detailLines).toContain("Period 2026-11-01 to 2026-11-30 (Europe/Tallinn)");
    expect(d.detailLines).not.toContain("Period started 2026-11-01");
  });
});

describe("describeMonthlyAllowance: unknown, no sessions, no source", () => {
  it("never shows a figure when no session has cost data", () => {
    const d = shown(unknown);
    expect(d).toMatchObject({ state: "unknown", statusLine: "AI Credits this month: unknown", figure: "AI Credits this month: unknown" });
    expect(d.note).toBe("No session this month has cost data, so no total is shown. Unknown is not 0.");
    expect(d.ariaLabel).toBe("AI Credits this month: unknown, 1,000 allowance, 12 days left, 0 of 9 sessions this month have cost data.");
    expect(d.detailLines.join("\n")).not.toMatch(/used|remain/);
    expect(d.statusLine).not.toMatch(/0 of/);
  });

  it("says there are no sessions", () => {
    const d = shown(noSessions);
    expect(d).toMatchObject({ state: "no-sessions", statusLine: "No sessions this month" });
    expect(d.note).toBe("No Copilot session started in this period on this machine.");
    expect(d.ariaLabel).toBe("No sessions this month, 1,000 AI Credits allowance, 1 day left.");
    expect(d.detailLines).not.toContain("0 of 0 sessions this month have cost data");
  });

  it("says no Copilot logs when the source is unavailable, whatever the figures say", () => {
    const d = shown(noSessions, { sourceAvailable: false });
    expect(d).toMatchObject({ state: "no-source", statusLine: "AI Credits this month: no Copilot logs" });
    expect(d.note).toBe("No Copilot Chat logs found on this machine.");
    expect(d.ariaLabel).toBe("AI Credits this month: no Copilot logs, 1,000 AI Credits allowance, 1 day left. No Copilot Chat logs found on this machine.");
  });

  it("has no note for a known month", () => {
    expect(shown(known()).note).toBeUndefined();
  });
});

describe("describeMonthlyAllowance: hidden and translation", () => {
  it("is hidden when the allowance is hidden", () => {
    expect(describeMonthlyAllowance({ level: "hidden" })).toEqual({ state: "hidden" });
  });

  it("sends every message through the translator and leaves figures alone", () => {
    const d = shown(known({ level: "near", used: 812.4, percent: 81 }), { t: upper });
    expect(d.statusLine).toBe("812.40 OF 1,000 AI CREDITS · NEAR LIMIT");
    expect(d.shortLevelWord).toBe("NEAR");
    expect(d.ariaLabel).toBe("NEAR LIMIT. AI CREDITS THIS MONTH: 812.40 OF 1,000 ALLOWANCE, 81 PERCENT, 12 DAYS LEFT, 20 OF 20 SESSIONS THIS MONTH HAVE COST DATA.");
    for (const line of d.detailLines) {
      expect(line).toBe(line.toUpperCase());
    }
  });
});
