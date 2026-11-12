// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Session, TokenCount } from "@agent-cost-analyzer/domain";
import { describe, expect, it } from "vitest";
import { upperCaseTranslate as T } from "../l10n/upper-case-translate.js";
import type { AllowanceSettings } from "../settings/allowance-settings.js";
import { buildMonthlyAllowance, type MonthlyAllowance, type MonthlyAllowanceInput, type MonthlyAllowanceView } from "./monthly-allowance.js";

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

function build(sessions: Session[], overrides: Partial<MonthlyAllowanceInput> = {}): MonthlyAllowanceView {
  return buildMonthlyAllowance({ sessions, now: NOW, timeZone: "UTC", settings: SETTINGS, ...overrides });
}

// The shown state: a test failing here means the gauge was hidden.
function shown(view: MonthlyAllowanceView): MonthlyAllowance {
  if (view.level === "hidden") {
    throw new Error("expected a shown gauge");
  }
  return view;
}

const used = (value: number) => shown(build([session(IN, value)]));

describe("buildMonthlyAllowance: hidden", () => {
  it("is hidden when the allowance is not set", () => {
    expect(build([session(IN, 5)], { settings: { ...SETTINGS, aiCredits: null } })).toEqual({ level: "hidden" });
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])("is hidden for an unusable allowance (%s)", (aiCredits) => {
    expect(build([session(IN, 5)], { settings: { ...SETTINGS, aiCredits } })).toEqual({ level: "hidden" });
  });
});

describe("buildMonthlyAllowance: the month's figures", () => {
  it("sums the period's known costs only, with remaining, days left and coverage", () => {
    const view = shown(build([session(IN, 300), session(LATER, 12.4), session(LAST_MONTH, 500)]));

    expect(view).toMatchObject({
      level: "normal",
      allowance: 1000,
      used: 312.4,
      atLeast: false,
      percent: 31,
      remaining: 687.6,
      daysLeft: 19,
      period: { startKey: "2026-11-01", endKeyExclusive: "2026-12-01" },
      coverage: { known: 2, total: 2 },
      countedSinceKey: "2026-11-03",
    });
    expect(view.text).toBe("$(dashboard) 312.40 of 1,000 AI Credits (31 %)");
  });

  it("never counts an unknown session as 0: the sum is a lower bound and the words say 'at least'", () => {
    const view = shown(build([session(IN, 300), session(LATER, 12.4), session(LATER, null)]));

    expect(view).toMatchObject({ used: 312.4, atLeast: true, percent: 31, remaining: 687.6, coverage: { known: 2, total: 3 } });
    expect(view.text).toBe("$(dashboard) At least 312.40 of 1,000 AI Credits (31 %)");
    expect(view.tooltip).toContain("2 of 3 sessions this month have cost data");
    expect(view.tooltip).toContain("The total may be higher: sessions without cost data are not counted.");
  });

  it("says unknown, never 0 and no percentage, when no session this month has cost data", () => {
    const view = shown(build([session(IN, null), session(LATER, null), session(LAST_MONTH, 40)]));

    expect(view).toMatchObject({ level: "normal", used: null, atLeast: false, percent: null, remaining: null, coverage: { known: 0, total: 2 } });
    expect(view.text).toBe("$(dashboard) AI Credits this month: unknown");
    expect(view.text).not.toMatch(/\b0\b|%/);
    expect(view.tooltip).toContain("0 of 2 sessions this month have cost data");
  });

  it("says there are no sessions this month rather than showing 0", () => {
    const view = shown(build([session(LAST_MONTH, 40)]));

    expect(view).toMatchObject({ level: "normal", used: null, percent: null, remaining: null, coverage: { known: 0, total: 0 }, countedSinceKey: undefined });
    expect(view.text).toBe("$(dashboard) No sessions this month");
    expect(shown(build([])).text).toBe("$(dashboard) No sessions this month");
  });

  it("rounds the sum to cents and formats with thousands separators", () => {
    const view = shown(build([session(IN, 1.004), session(LATER, 2.003)], { settings: { ...SETTINGS, aiCredits: 12345.5 } }));

    expect(view.used).toBe(3.01);
    expect(view.text).toBe("$(dashboard) 3.01 of 12,345.5 AI Credits (0 %)");
  });
});

describe("buildMonthlyAllowance: levels, in words as well as colour", () => {
  it("is normal below the warning percentage (79.9 %)", () => {
    const view = used(799);

    expect(view.level).toBe("normal");
    expect(view.percent).toBe(79);
    expect(view.text).toBe("$(dashboard) 799.00 of 1,000 AI Credits (79 %)");
  });

  it("is near at exactly the warning percentage (80 %), and says so", () => {
    const view = used(800);

    expect(view.level).toBe("near");
    expect(view.text).toBe("$(warning) Near limit: 800.00 of 1,000 AI Credits (80 %)");
    expect(view.ariaLabel.startsWith("Near limit. ")).toBe(true);
  });

  it("stays near just under the allowance", () => {
    expect(used(999.99)).toMatchObject({ level: "near", percent: 99, remaining: 0.01 });
  });

  it("is over at exactly the allowance (100 %), with nothing remaining", () => {
    const view = used(1000);

    expect(view).toMatchObject({ level: "over", percent: 100, remaining: 0 });
    expect(view.text).toBe("$(error) Over: 1,000.00 of 1,000 AI Credits (100 %)");
    expect(view.ariaLabel.startsWith("Over the allowance. ")).toBe(true);
  });

  it("is over above the allowance", () => {
    const view = used(1042.1);

    expect(view).toMatchObject({ level: "over", percent: 104, remaining: 0 });
    expect(view.text).toBe("$(error) Over: 1,042.10 of 1,000 AI Credits (104 %)");
    expect(view.tooltip).toContain("No AI Credits remain");
  });

  it("keeps 'at least' in the near and over words when some sessions are unknown", () => {
    expect(shown(build([session(IN, 812.4), session(LATER, null)])).text).toBe("$(warning) Near limit: at least 812.40 of 1,000 AI Credits (81 %)");
    expect(shown(build([session(IN, 1042.1), session(LATER, null)])).text).toBe("$(error) Over: at least 1,042.10 of 1,000 AI Credits (104 %)");
  });

  it("warns at the user's percentage", () => {
    const settings = { ...SETTINGS, warnAtPercent: 50 };

    expect(shown(build([session(IN, 499.99)], { settings })).level).toBe("normal");
    expect(shown(build([session(IN, 500)], { settings })).level).toBe("near");
  });

  it("does not let float error decide a level or a percentage", () => {
    const view = shown(build([session(IN, 0.1), session(LATER, 0.2), session(LATER, 0.27)], { settings: { ...SETTINGS, aiCredits: 1 } }));

    expect(view).toMatchObject({ used: 0.57, percent: 57, level: "normal" });
  });
});

describe("buildMonthlyAllowance: which sessions count", () => {
  it("counts sessions from the period's first day up to, not including, the next period's", () => {
    const view = shown(
      build([
        session("2026-10-31T23:59:59Z", 1),
        session("2026-11-01T00:00:00Z", 2),
        session("2026-11-30T23:59:59Z", 4),
        session("2026-12-01T00:00:00Z", 8),
      ]),
    );

    expect(view).toMatchObject({ used: 6, coverage: { known: 2, total: 2 }, countedSinceKey: "2026-11-01" });
  });

  it("judges the period edges in the user's time zone", () => {
    const lateOctoberUtc = [session("2026-10-31T22:30:00Z", 3)];

    expect(shown(build(lateOctoberUtc, { timeZone: "Europe/Helsinki" })).used).toBe(3);
    expect(shown(build(lateOctoberUtc, { timeZone: "UTC" })).used).toBeNull();
  });

  it("follows the reset day: the period starts in the previous month before it", () => {
    const settings = { ...SETTINGS, resetDay: 15 };
    const view = shown(build([session("2026-10-14T12:00:00Z", 1), session("2026-10-15T00:00:00Z", 2), session("2026-11-14T23:00:00Z", 4)], { settings }));

    expect(view).toMatchObject({ used: 6, daysLeft: 3, period: { startKey: "2026-10-15", endKeyExclusive: "2026-11-15" } });
  });

  it("leaves out a session without a start, or with an unreadable one: it cannot be placed in a period", () => {
    const view = shown(build([session(IN, 5), session(undefined, 7), session("garbage", 9)]));

    expect(view).toMatchObject({ used: 5, atLeast: false, coverage: { known: 1, total: 1 } });
  });

  // D7 (v1): a session is known or unknown as a whole. An `estimated` AI
  // Credits value is a local-tokenizer guess, not what GitHub billed, so the
  // gauge treats it as unknown: the sum stays a lower bound of billed credits
  // ("at least") instead of mixing a guess into a figure read against a bill.
  it("treats an estimated AI Credits value as unknown, so the sum stays billed credits only", () => {
    const view = shown(build([session(IN, 100), session(LATER, { known: true, value: 50, estimated: true })]));

    expect(view).toMatchObject({ used: 100, atLeast: true, coverage: { known: 1, total: 2 } });
    expect(view.text).toBe("$(dashboard) At least 100.00 of 1,000 AI Credits (10 %)");
  });

  it("never shows a session's title, which is logged text", () => {
    const view = shown(build([session(IN, 5, "<img src=x onerror=alert(1)> secret-repo")]));

    expect(JSON.stringify(view)).not.toMatch(/img|secret-repo/);
  });
});

describe("buildMonthlyAllowance: tooltip, screen-reader label and Sessions row", () => {
  it("spells out allowance, remaining, days left, period, coverage and where the sessions come from", () => {
    expect(shown(build([session(IN, 300), session(LATER, 12.4)])).tooltip).toBe(
      [
        "Monthly allowance: 1,000 AI Credits",
        "Up to 687.60 AI Credits remain",
        "19 days left",
        "Period started 2026-11-01",
        "2 of 2 sessions this month have cost data",
        "Oldest session counted: 2026-11-03",
        "Only sessions recorded on this machine are counted.",
      ].join("\n"),
    );
  });

  it("uses the grammar of one session and one day", () => {
    const view = shown(build([session("2026-11-30T09:00:00Z", 1)], { now: new Date("2026-11-30T12:00:00Z") }));

    expect(view.daysLeft).toBe(1);
    expect(view.tooltip).toContain("1 day left");
    expect(view.tooltip).toContain("1 of 1 session this month has cost data");
  });

  it("leaves remaining and coverage out when there is nothing to say", () => {
    expect(shown(build([])).tooltip).toBe(["Monthly allowance: 1,000 AI Credits", "19 days left", "Period started 2026-11-01", "Only sessions recorded on this machine are counted."].join("\n"));
    expect(shown(build([session(IN, null)])).tooltip).not.toContain("remain");
  });

  it("states the full meaning for screen readers, level word first", () => {
    expect(shown(build([session(IN, 300), session(LATER, null)])).ariaLabel).toBe(
      "AI Credits this month: at least 300.00 of 1,000 allowance, 30 percent, 19 days left, 1 of 2 sessions this month have cost data. Open Sessions.",
    );
    expect(used(1042.1).ariaLabel).toBe(
      "Over the allowance. AI Credits this month: 1,042.10 of 1,000 allowance, 104 percent, 19 days left, 1 of 1 session this month has cost data. Open Sessions.",
    );
    expect(shown(build([session(IN, null)])).ariaLabel).toBe(
      "AI Credits this month: unknown, 1,000 allowance, 19 days left, 0 of 1 session this month has cost data. Open Sessions.",
    );
    expect(shown(build([])).ariaLabel).toBe("No sessions this month, 1,000 AI Credits allowance, 19 days left. Open Sessions.");
  });

  it("gives the Sessions view row its text", () => {
    expect(used(312.4).rowText).toBe("This month: 312.40 of 1,000 AI Credits (31 %) · 19 days left");
    expect(used(800).rowText).toBe("This month: Near limit: 800.00 of 1,000 AI Credits (80 %) · 19 days left");
    expect(shown(build([session(IN, null)])).rowText).toBe("This month: AI Credits unknown · 19 days left");
    expect(shown(build([])).rowText).toBe("This month: no sessions · 19 days left");
  });
});

describe("buildMonthlyAllowance: translation (vscode-extension.md §3.5 Localization)", () => {
  it("translates every text piece but keeps numbers and the codicon outside the message", () => {
    const view = shown(build([session(IN, 812.4), session(LATER, null)], { t: T }));

    expect(view.text).toBe("$(warning) NEAR LIMIT: AT LEAST 812.40 OF 1,000 AI CREDITS (81 %)");
    expect(view.tooltip.split("\n")).toEqual([
      "MONTHLY ALLOWANCE: 1,000 AI CREDITS",
      "UP TO 187.60 AI CREDITS REMAIN",
      "19 DAYS LEFT",
      "PERIOD STARTED 2026-11-01",
      "1 OF 2 SESSIONS THIS MONTH HAVE COST DATA",
      "OLDEST SESSION COUNTED: 2026-11-03",
      "THE TOTAL MAY BE HIGHER: SESSIONS WITHOUT COST DATA ARE NOT COUNTED.",
      "ONLY SESSIONS RECORDED ON THIS MACHINE ARE COUNTED.",
    ]);
    expect(view.ariaLabel).toBe(
      "NEAR LIMIT. AI CREDITS THIS MONTH: AT LEAST 812.40 OF 1,000 ALLOWANCE, 81 PERCENT, 19 DAYS LEFT, 1 OF 2 SESSIONS THIS MONTH HAVE COST DATA. OPEN SESSIONS.",
    );
    expect(view.rowText).toBe("THIS MONTH: NEAR LIMIT: AT LEAST 812.40 OF 1,000 AI CREDITS (81 %) · 19 DAYS LEFT");
  });

  it("translates the unknown and no-sessions states", () => {
    expect(shown(build([session(IN, null)], { t: T })).text).toBe("$(dashboard) AI CREDITS THIS MONTH: UNKNOWN");
    expect(shown(build([], { t: T })).text).toBe("$(dashboard) NO SESSIONS THIS MONTH");
  });
});
