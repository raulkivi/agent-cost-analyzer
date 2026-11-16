// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  describeMonthlyAllowance,
  type AllowanceLevel,
  type AllowanceState,
  type MonthlyAllowanceAnswer,
  type MonthlyAllowanceResult,
} from "@agent-cost-analyzer/domain";

// MS6 (monthly-allowance-standalone.md §4.7): the view model of the header
// gauge and its dialogs, built from the server's answer. The wording is the
// domain's `describeMonthlyAllowance` (shared with the extension's status bar);
// this adds only what the app lays out: the narrow form, the meter, the
// by-harness rows and the fixed "Not counted" list. Pure: no React, no fetch.

const NOT_SET_TEXT = "Set monthly allowance";

// Fixed text, from the approved boards (docs/plans/mockups/monthly-allowance-standalone).
const NOT_COUNTED = [
  "Sessions whose logs Copilot already pruned.",
  "Spend made elsewhere: github.com chat, the cloud agent, other machines.",
  "A session counts wholly in the period it started in.",
  "Claude Code, pi and mitmproxy sessions record no AI Credits.",
];

const HARNESS_LABELS = { local: "Copilot Chat", "agent-host": "Agent Host and Copilot CLI" } as const;

const CENTS = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface AllowanceMeter {
  // 0 to 100, from the percent rounded down; full when over.
  fillPercent: number;
  warnAtPercent: number;
  // The figure is a lower bound: draw a dashed open end, never an exact fill.
  openEnded: boolean;
  // Over: the cap that sticks out past the end.
  overflow: boolean;
}

export interface HarnessRow {
  harness: keyof typeof HARNESS_LABELS;
  label: string;
  // "14 of 14": sessions with cost data of sessions.
  coverage: string;
  // "640.10", "at least 540.10" or "unknown", never 0 for a missing sum.
  credits: string;
}

export interface AllowanceView {
  state: AllowanceState;
  // For styling only; the words carry the level. "normal" unless the state is known.
  level: AllowanceLevel;
  // The header button's text: figure first, level last ("near limit", "over").
  headerText: string;
  // The same at the narrow breakpoint: the figure plus the short word ("near", "over").
  narrowText: string;
  figureText: string;
  levelWord: string | undefined;
  shortLevelWord: string | undefined;
  // The level sentence first when near or over (the details and aria keep the full words).
  ariaLabel: string;
  daysLeft: string;
  // Absent with unknown, no sessions, no source and not set: no meter, no exact-looking bar.
  meter: AllowanceMeter | undefined;
  // Not set: the button opens the settings dialog, there are no details to show.
  hasDetails: boolean;
  detailLines: string[];
  // One sentence explaining unknown, no sessions or no source.
  note: string | undefined;
  // "VS Code" or "VS Code Insiders"; a fixed label, never a path.
  sourceLabel: string | undefined;
  byHarness: HarnessRow[];
  notCounted: string[];
}

// The domain's input from the answer. A state without figures gets none, so
// `used` stays null and unknown is never 0.
function resultOf(answer: MonthlyAllowanceAnswer): MonthlyAllowanceResult {
  const { settings, period, figures } = answer;
  if (answer.state === "not-set" || settings.aiCredits === null) {
    return { level: "hidden" };
  }
  const base = { allowance: settings.aiCredits, daysLeft: period.daysLeft, period: { startKey: period.startKey, endKeyExclusive: period.endKeyExclusive } };
  if (figures !== undefined && "used" in figures) {
    const { level, used, atLeast, percent, remaining, coverage, countedSinceKey } = figures;
    return { ...base, level, used, atLeast, percent, remaining, coverage, countedSinceKey };
  }
  return {
    ...base,
    level: "normal",
    used: null,
    atLeast: false,
    percent: null,
    remaining: null,
    coverage: figures?.coverage ?? { known: 0, total: 0 },
    countedSinceKey: figures?.countedSinceKey,
  };
}

function meterOf(answer: MonthlyAllowanceAnswer): AllowanceMeter | undefined {
  const { figures } = answer;
  if (answer.state !== "known" || figures === undefined || !("used" in figures)) {
    return undefined;
  }
  return {
    fillPercent: Math.min(figures.percent, 100),
    warnAtPercent: answer.settings.warnAtPercent,
    openEnded: figures.atLeast,
    overflow: figures.level === "over",
  };
}

function harnessRows(answer: MonthlyAllowanceAnswer): HarnessRow[] {
  return answer.source.byHarness
    .filter(({ total }) => total > 0)
    .map(({ harness, known, total, used }) => ({
      harness,
      label: HARNESS_LABELS[harness],
      coverage: `${known} of ${total}`,
      credits: used === null ? "unknown" : known < total ? `at least ${CENTS.format(used)}` : CENTS.format(used),
    }));
}

export function allowanceView(answer: MonthlyAllowanceAnswer): AllowanceView {
  const described = describeMonthlyAllowance(resultOf(answer), { sourceAvailable: answer.source.available, timeZone: answer.period.timeZone });
  if (described.state === "hidden") {
    return {
      state: "not-set",
      level: "normal",
      headerText: NOT_SET_TEXT,
      narrowText: NOT_SET_TEXT,
      figureText: NOT_SET_TEXT,
      levelWord: undefined,
      shortLevelWord: undefined,
      ariaLabel: NOT_SET_TEXT,
      daysLeft: "",
      meter: undefined,
      hasDetails: false,
      detailLines: [],
      note: undefined,
      sourceLabel: undefined,
      byHarness: [],
      notCounted: [],
    };
  }
  return {
    state: answer.state,
    level: described.level,
    headerText: described.statusLine,
    narrowText: described.shortLevelWord === undefined ? described.statusLine : `${described.figure} · ${described.shortLevelWord}`,
    figureText: described.figure,
    levelWord: described.levelWord,
    shortLevelWord: described.shortLevelWord,
    ariaLabel: described.ariaLabel,
    daysLeft: described.daysLeft,
    meter: meterOf(answer),
    hasDetails: true,
    detailLines: described.detailLines,
    note: described.note,
    sourceLabel: answer.source.variant ?? undefined,
    byHarness: harnessRows(answer),
    notCounted: NOT_COUNTED,
  };
}

// The settings dialog's inputs as text: empty for "not set", so the field
// shows its placeholder; the reset day and threshold are kept either way.
export function settingsDialogDefaults(answer: MonthlyAllowanceAnswer): { aiCredits: string; resetDay: string; warnAtPercent: string } {
  const { aiCredits, resetDay, warnAtPercent } = answer.settings;
  return { aiCredits: aiCredits === null ? "" : String(aiCredits), resetDay: String(resetDay), warnAtPercent: String(warnAtPercent) };
}
