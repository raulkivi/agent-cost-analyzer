// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { Session } from "../session.js";
import type { TokenCount } from "../token-count.js";
import type { AllowanceSettings } from "./allowance-settings.js";
import { computeMonthlyAllowance, type MonthlyAllowanceFigures, type MonthlyAllowanceInput, type MonthlyAllowanceResult } from "./monthly-allowance.js";

let nextId = 0;
function session(startedAt: string | undefined, cost: number | null | TokenCount, title = "a session"): Session {
  nextId += 1;
  const costAiCredits: TokenCount = cost === null ? { known: false, reason: "x" } : typeof cost === "number" ? { known: true, value: cost } : cost;
  return {
    id: `s${nextId}`,
    mode: "analyze",
    title,
    model: "claude-sonnet-5",
    turns: [],
    turnCount: 1,
    costAiCredits,
    usageDataAvailable: true,
    startedAt,
  };
}

// Period with reset day 1 in UTC: 2026-11-01 to 2026-12-01, 19 days left.
const NOW = new Date("2026-11-12T12:00:00Z");
const IN = "2026-11-03T09:00:00Z";
const LATER = "2026-11-10T09:00:00Z";
const LAST_MONTH = "2026-10-20T09:00:00Z";
const SETTINGS: AllowanceSettings = { aiCredits: 1000, resetDay: 1, warnAtPercent: 80 };

function compute(sessions: Session[], overrides: Partial<MonthlyAllowanceInput> = {}): MonthlyAllowanceResult {
  return computeMonthlyAllowance({ sessions, now: NOW, timeZone: "UTC", settings: SETTINGS, ...overrides });
}

// The shown figures: a test failing here means the gauge was hidden.
function shown(result: MonthlyAllowanceResult): MonthlyAllowanceFigures {
  if (result.level === "hidden") {
    throw new Error("expected figures");
  }
  return result;
}

const used = (value: number) => shown(compute([session(IN, value)]));

describe("computeMonthlyAllowance: hidden", () => {
  it("is hidden when the allowance is not set", () => {
    expect(compute([session(IN, 5)], { settings: { ...SETTINGS, aiCredits: null } })).toEqual({ level: "hidden" });
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])("is hidden for an unusable allowance (%s)", (aiCredits) => {
    expect(compute([session(IN, 5)], { settings: { ...SETTINGS, aiCredits } })).toEqual({ level: "hidden" });
  });
});

describe("computeMonthlyAllowance: the month's figures", () => {
  it("sums the period's known costs only, with remaining, days left and coverage, and nothing else", () => {
    expect(shown(compute([session(IN, 300), session(LATER, 12.4), session(LAST_MONTH, 500)]))).toEqual({
      level: "normal",
      allowance: 1000,
      used: 312.4,
      atLeast: false, // codespell:ignore atleast
      percent: 31,
      remaining: 687.6,
      daysLeft: 19,
      period: { startKey: "2026-11-01", endKeyExclusive: "2026-12-01" },
      coverage: { known: 2, total: 2 },
      countedSinceKey: "2026-11-03",
    });
  });

  it("never counts an unknown session as 0: the sum is a lower bound ('at least')", () => {
    expect(shown(compute([session(IN, 300), session(LATER, 12.4), session(LATER, null)]))).toMatchObject({
      used: 312.4,
      atLeast: true, // codespell:ignore atleast
      percent: 31,
      remaining: 687.6,
      coverage: { known: 2, total: 3 },
    });
  });

  it("is unknown (null, never 0) with no percentage or remaining when no session this month has cost data", () => {
    expect(shown(compute([session(IN, null), session(LATER, null), session(LAST_MONTH, 40)]))).toMatchObject({
      level: "normal",
      used: null,
      atLeast: false, // codespell:ignore atleast
      percent: null,
      remaining: null,
      coverage: { known: 0, total: 2 },
      countedSinceKey: "2026-11-03",
    });
  });

  it("keeps estimated-only months unknown: a local estimate is never billed", () => {
    const estimated: TokenCount = { known: true, value: 50, estimated: true };

    expect(shown(compute([session(IN, estimated), session(LATER, estimated)]))).toMatchObject({ used: null, percent: null, remaining: null, coverage: { known: 0, total: 2 } });
  });

  it("has no sessions, rather than 0, when nothing started this period", () => {
    expect(shown(compute([session(LAST_MONTH, 40)]))).toMatchObject({
      level: "normal",
      used: null,
      percent: null,
      remaining: null,
      coverage: { known: 0, total: 0 },
      countedSinceKey: undefined,
    });
    expect(shown(compute([])).coverage).toEqual({ known: 0, total: 0 });
  });

  it("reads a known 0 as 0 used, which is not unknown", () => {
    expect(used(0)).toMatchObject({ used: 0, percent: 0, remaining: 1000, atLeast: false, coverage: { known: 1, total: 1 } }); // codespell:ignore atleast
  });

  it("rounds the sum to cents", () => {
    const figures = shown(compute([session(IN, 1.004), session(LATER, 2.003)], { settings: { ...SETTINGS, aiCredits: 12345.5 } }));

    expect(figures).toMatchObject({ used: 3.01, allowance: 12345.5 });
  });
});

describe("computeMonthlyAllowance: levels", () => {
  it("is normal below the warning percentage (79.9 %)", () => {
    expect(used(799)).toMatchObject({ level: "normal", percent: 79 });
  });

  it("is near at exactly the warning percentage (80 %)", () => {
    expect(used(800)).toMatchObject({ level: "near", percent: 80 });
  });

  it("stays near just under the allowance", () => {
    expect(used(999.99)).toMatchObject({ level: "near", percent: 99, remaining: 0.01 });
  });

  it("is over at exactly the allowance (100 %), with nothing remaining", () => {
    expect(used(1000)).toMatchObject({ level: "over", percent: 100, remaining: 0 });
  });

  it("is over above the allowance, and remaining never goes below 0", () => {
    expect(used(1042.1)).toMatchObject({ level: "over", percent: 104, remaining: 0 });
  });

  it("keeps 'at least' at near and over when some sessions are unknown", () => {
    expect(shown(compute([session(IN, 812.4), session(LATER, null)]))).toMatchObject({ level: "near", atLeast: true }); // codespell:ignore atleast
    expect(shown(compute([session(IN, 1042.1), session(LATER, null)]))).toMatchObject({ level: "over", atLeast: true }); // codespell:ignore atleast
  });

  it("warns at the user's percentage", () => {
    const settings = { ...SETTINGS, warnAtPercent: 50 };

    expect(shown(compute([session(IN, 499.99)], { settings })).level).toBe("normal");
    expect(shown(compute([session(IN, 500)], { settings })).level).toBe("near");
  });

  it("does not let float error decide a level or a percentage", () => {
    const figures = shown(compute([session(IN, 0.1), session(LATER, 0.2), session(LATER, 0.27)], { settings: { ...SETTINGS, aiCredits: 1 } }));

    expect(figures).toMatchObject({ used: 0.57, percent: 57, level: "normal" });
  });
});

describe("computeMonthlyAllowance: which sessions count", () => {
  it("counts sessions from the period's first day up to, not including, the next period's", () => {
    const figures = shown(
      compute([
        session("2026-10-31T23:59:59Z", 1),
        session("2026-11-01T00:00:00Z", 2),
        session("2026-11-30T23:59:59Z", 4),
        session("2026-12-01T00:00:00Z", 8),
      ]),
    );

    expect(figures).toMatchObject({ used: 6, coverage: { known: 2, total: 2 }, countedSinceKey: "2026-11-01" });
  });

  it("follows the reset day: the period starts in the previous month before it", () => {
    const settings = { ...SETTINGS, resetDay: 15 };
    const figures = shown(compute([session("2026-10-14T12:00:00Z", 1), session("2026-10-15T00:00:00Z", 2), session("2026-11-14T23:00:00Z", 4)], { settings }));

    expect(figures).toMatchObject({ used: 6, daysLeft: 3, period: { startKey: "2026-10-15", endKeyExclusive: "2026-11-15" } });
  });

  it("leaves out a session without a start, or with an unreadable one: it cannot be placed in a period", () => {
    expect(shown(compute([session(IN, 5), session(undefined, 7), session("garbage", 9)]))).toMatchObject({ used: 5, atLeast: false, coverage: { known: 1, total: 1 } }); // codespell:ignore atleast
  });

  it("carries no session id or title, which is logged text", () => {
    const figures = shown(compute([session(IN, 5, "<img src=x onerror=alert(1)> secret-repo")]));

    expect(JSON.stringify(figures)).not.toMatch(/img|secret-repo|"s\d+"/);
  });
});

describe("computeMonthlyAllowance: time zones", () => {
  const lateOctoberUtc = [session("2026-10-31T22:30:00Z", 3)];

  it("judges the period edges in the user's time zone", () => {
    expect(shown(compute(lateOctoberUtc, { timeZone: "Europe/Helsinki" })).used).toBe(3);
    expect(shown(compute(lateOctoberUtc, { timeZone: "UTC" })).used).toBeNull();
    expect(shown(compute(lateOctoberUtc, { timeZone: "America/Los_Angeles" })).used).toBeNull();
  });

  it("dates the oldest session counted in the user's zone", () => {
    expect(shown(compute(lateOctoberUtc, { timeZone: "Europe/Helsinki" })).countedSinceKey).toBe("2026-11-01");
  });

  it("starts the period at the first instant of the local day in a zone at +14", () => {
    const sessions = [session("2026-10-31T09:59:59.999Z", 1), session("2026-10-31T10:00:00Z", 2)];

    expect(shown(compute(sessions, { timeZone: "Pacific/Kiritimati" }))).toMatchObject({ used: 2, coverage: { known: 1, total: 1 } });
  });

  it("follows an offset that is not a whole hour", () => {
    const sessions = [session("2026-10-31T18:14:59Z", 1), session("2026-10-31T18:15:00Z", 2)];

    expect(shown(compute(sessions, { timeZone: "Asia/Kathmandu" }))).toMatchObject({ used: 2, coverage: { known: 1, total: 1 } });
  });

  it("works for the machine's own zone when none is given", () => {
    const figures = shown(computeMonthlyAllowance({ sessions: [session(IN, 5)], now: NOW, settings: SETTINGS }));

    expect(figures.period.startKey).toBe("2026-11-01");
    expect(figures.used).toBe(5);
  });
});

describe("computeMonthlyAllowance: daylight saving", () => {
  it("starts a period on a day whose midnight is skipped at 01:00 local", () => {
    // America/Santiago: 2026-09-06 begins at 01:00 (04:00 UTC).
    const settings = { ...SETTINGS, resetDay: 6 };
    const sessions = [session("2026-09-06T03:59:59.999Z", 1), session("2026-09-06T04:00:00Z", 2)];
    const figures = shown(compute(sessions, { now: new Date("2026-09-20T12:00:00Z"), timeZone: "America/Santiago", settings }));

    expect(figures).toMatchObject({ used: 2, period: { startKey: "2026-09-06", endKeyExclusive: "2026-10-06" }, countedSinceKey: "2026-09-06" });
  });

  it("ends a period on the local midnight before clocks go back", () => {
    // Europe/Tallinn: clocks go back at 04:00 on 2026-10-25; that day starts at 21:00 UTC the day before.
    const settings = { ...SETTINGS, resetDay: 25 };
    const sessions = [session("2026-10-24T20:59:59Z", 1), session("2026-10-24T21:00:00Z", 2)];
    const figures = shown(compute(sessions, { now: new Date("2026-10-20T12:00:00Z"), timeZone: "Europe/Tallinn", settings }));

    expect(figures).toMatchObject({ used: 1, daysLeft: 5, period: { startKey: "2026-09-25", endKeyExclusive: "2026-10-25" } });
  });

  it("counts a session in the repeated hour once, in the day it started", () => {
    // Europe/Tallinn: 03:30 local happens twice on 2026-10-25 (00:30 and 01:30 UTC).
    const sessions = [session("2026-10-25T00:30:00Z", 1), session("2026-10-25T01:30:00Z", 2)];
    const figures = shown(compute(sessions, { now: new Date("2026-10-26T12:00:00Z"), timeZone: "Europe/Tallinn" }));

    expect(figures).toMatchObject({ used: 3, coverage: { known: 2, total: 2 }, countedSinceKey: "2026-10-25" });
  });
});

describe("computeMonthlyAllowance: month boundaries", () => {
  it("crosses the year end with a mid-month reset day", () => {
    const settings = { ...SETTINGS, resetDay: 10 };
    const sessions = [session("2026-12-09T23:59:59Z", 1), session("2026-12-10T00:00:00Z", 2), session("2027-01-04T10:00:00Z", 4)];

    expect(shown(compute(sessions, { now: new Date("2027-01-05T10:00:00Z"), settings }))).toMatchObject({
      used: 6,
      period: { startKey: "2026-12-10", endKeyExclusive: "2027-01-10" },
      daysLeft: 5,
    });
  });

  it("includes the leap day in a period that starts on the 28th", () => {
    const settings = { ...SETTINGS, resetDay: 28 };
    const sessions = [session("2028-02-27T23:59:59Z", 1), session("2028-02-28T00:00:00Z", 2), session("2028-02-29T12:00:00Z", 4)];

    expect(shown(compute(sessions, { now: new Date("2028-03-05T10:00:00Z"), settings }))).toMatchObject({
      used: 6,
      period: { startKey: "2028-02-28", endKeyExclusive: "2028-03-28" },
    });
  });

  it("counts the last day of a 31-day month and not the next month's first", () => {
    const sessions = [session("2026-12-31T23:59:59.999Z", 1), session("2027-01-01T00:00:00Z", 2)];

    expect(shown(compute(sessions, { now: new Date("2026-12-31T12:00:00Z") }))).toMatchObject({ used: 1, daysLeft: 1 });
  });
});
