// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { AuditRollup, OutcomeTotals, SessionAudit, TokenCount } from "@agent-cost-analyzer/domain";
import { formatCount, formatDay, periodText, pluralize, UNKNOWN_TEXT } from "./format.js";

// U4, tool-call audit (docs/plans/mcp-apps.md §4.5, board ToolCallAudit.dc.html).
// Pure: formats a get_session_audit or get_audit_rollup result for display.
//
// The failure rate is over calls with a known outcome; calls with an unknown
// outcome are counted apart and are neither a success nor a failure. Recovery
// cost is in tokens, not AI Credits (owner answer Q9): the tool reports the
// tokens of the affected turns, and nothing here converts them.
//
// Commands, session titles and tool names are logged text: display only,
// never sent to the host's model (§6).

export interface AuditTile {
  text: string;
  known: boolean;
  note?: string;
}

export interface CategoryRow {
  label: string; // the category as the tool names it
  count: number;
  fraction: number; // against the largest category, for the bar
}

export interface CategoryBars {
  title: string; // "14 failed calls by category"
  rows: CategoryRow[];
  emptyText: string; // what to say when there are no rows: no failures, or no known outcome
}

export interface DayPoint {
  label: string;
  value: number | null; // failed calls; null = no call that day has a known outcome
  text: string;
}

export interface CommandRow {
  command: string; // logged text
  category?: string;
  failsText: string;
  sessionsText: string;
}

export interface SessionAuditViewModel {
  title: string;
  metaText: string;
  unavailableReason?: string;
  tiles: { toolCalls: AuditTile; failed: AuditTile; failureRate: AuditTile; unknown: AuditTile };
  categories: CategoryBars;
  recovery: {
    unitLabel: string;
    none: boolean;
    noneText: string;
    rounds: AuditTile;
    affectedTurns: AuditTile;
    tokens: AuditTile;
    tokensNote: string;
    caveat: string;
  };
  retries: { command: string; triesText: string; resultText: string; succeeded: boolean }[];
  byTool: { name: string; callsText: string; failedText: string }[];
}

export interface AuditRollupViewModel {
  periodText?: string;
  sessionsText: string;
  unavailableReason?: string;
  tiles: { toolCalls: AuditTile; failed: AuditTile; failureRate: AuditTile };
  leftOut?: { text: string; note: string };
  daily: { points: DayPoint[]; maxValue: number | null };
  categories: CategoryBars;
  topCommands: CommandRow[];
  sessions: { rows: { title: string; startedText?: string; callsText: string; failedText: string; unknownText: string }[]; shownNote?: string };
}

const MAX_SESSIONS = 10;
const MAX_TURNS_LISTED = 12;

const unknownTile = (note?: string): AuditTile => ({ text: UNKNOWN_TEXT, known: false, ...(note === undefined ? {} : { note }) });
const failedOf = (totals: Pick<OutcomeTotals, "failed" | "interrupted" | "denied">): number => totals.failed + totals.interrupted + totals.denied;

function failureBreakdown(totals: OutcomeTotals): string {
  return [
    totals.failed > 0 ? `error ${formatCount(totals.failed)}` : undefined,
    totals.interrupted > 0 ? `interrupted ${formatCount(totals.interrupted)}` : undefined,
    totals.denied > 0 ? `denied ${formatCount(totals.denied)}` : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
}

// An unknown outcome is not counted as a success, so with none known there is
// no failure count and no rate: Unknown, never 0 (constraint 6).
function outcomeTiles(totals: OutcomeTotals, failureRate: number | null, knownCalls: number, unavailable: boolean): { failed: AuditTile; failureRate: AuditTile; unknown: AuditTile } {
  if (unavailable) return { failed: unknownTile(), failureRate: unknownTile(), unknown: unknownTile() };
  const unknown: AuditTile = { text: formatCount(totals.unknown), known: true, note: "calls: not counted as success or failure" };
  if (failureRate === null || knownCalls === 0) {
    return { failed: unknownTile("no call has a known outcome"), failureRate: unknownTile("no call has a known outcome"), unknown };
  }
  const breakdown = failureBreakdown(totals);
  return {
    failed: { text: formatCount(failedOf(totals)), known: true, ...(breakdown === "" ? {} : { note: breakdown }) },
    failureRate: { text: `${(failureRate * 100).toFixed(1)} %`, known: true, note: `of ${formatCount(knownCalls)} calls with a known outcome` },
    unknown,
  };
}

function categoryBars(rows: readonly { category: string; count: number }[], outcomesKnown: boolean): CategoryBars {
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  const largest = sorted[0]?.count ?? 0;
  const total = sorted.reduce((sum, row) => sum + row.count, 0);
  return {
    title: `${formatCount(total)} failed ${total === 1 ? "call" : "calls"} by category`,
    rows: sorted.map((row) => ({ label: row.category, count: row.count, fraction: largest > 0 ? row.count / largest : 0 })),
    emptyText: outcomesKnown ? "No failed calls." : "No call has a known outcome, so no failure is counted.",
  };
}

function tokenText(count: TokenCount): string {
  return count.known ? formatCount(count.value) : UNKNOWN_TEXT;
}

function turnsNote(turns: readonly number[]): string | undefined {
  if (turns.length === 0) return undefined;
  const shown = turns.slice(0, MAX_TURNS_LISTED).join(", ");
  return turns.length > MAX_TURNS_LISTED ? `turns ${shown} and ${turns.length - MAX_TURNS_LISTED} more` : `turns ${shown}`;
}

function recoveryOf(audit: SessionAudit, outcomesKnown: boolean): SessionAuditViewModel["recovery"] {
  const cost = audit.failureRecoveryCost;
  const out = cost.affectedTurnsOutputTokens;
  const input = cost.affectedTurnsInputTokens;
  const notes = ["input counts uncached, cache write and cache read"];
  for (const count of [out, input]) if (!count.known) notes.push(count.reason);
  if ((out.known && out.estimated === true) || (input.known && input.estimated === true)) notes.push("includes estimated counts");
  const turnsList = turnsNote(cost.affectedTurns);
  return {
    unitLabel: "tokens, not AI Credits",
    none: cost.recoveryRounds === 0 && cost.affectedTurns.length === 0,
    noneText: outcomesKnown ? "No failed calls, so no recovery cost." : "No call has a known outcome, so no recovery cost is counted.",
    rounds: { text: formatCount(cost.recoveryRounds), known: true, note: "follow-up rounds after a failed call" },
    affectedTurns: { text: formatCount(cost.affectedTurns.length), known: true, ...(turnsList === undefined ? {} : { note: turnsList }) },
    tokens: { text: `${tokenText(out)} out · ${tokenText(input)} in`, known: out.known && input.known },
    tokensNote: notes.length === 1 ? notes[0]! : `${notes[0]!}; ${notes.slice(1).join("; ")}`,
    caveat: "Per-round tokens are not recorded, so the cost is exact for the affected turns, not an estimate per round.",
  };
}

export function toSessionAuditViewModel(audit: SessionAudit): SessionAuditViewModel {
  const unavailable = audit.toolCallsUnavailableReason !== undefined;
  const turns = audit.perTurn.length;
  const started = formatDay(audit.startedAt);
  const vm: SessionAuditViewModel = {
    title: audit.title === undefined || audit.title.trim() === "" ? `Session ${audit.sessionId}` : audit.title,
    metaText: [`session ${audit.sessionId}`, started].filter((part) => part !== undefined).join(" · "),
    tiles: {
      toolCalls: unavailable ? unknownTile() : { text: formatCount(audit.totals.toolCalls), known: true, ...(turns > 0 ? { note: `across ${pluralize(turns, "turn")}` } : {}) },
      ...outcomeTiles(audit.totals, audit.failureRate, audit.outcomeCoverage.known, unavailable),
    },
    categories: categoryBars(audit.byFailureCategory, audit.failureRate !== null),
    recovery: recoveryOf(audit, audit.failureRate !== null),
    retries: audit.retries.map((retry) => ({
      command: retry.command,
      triesText: formatCount(retry.attempts),
      resultText: retry.eventuallySucceeded ? `succeeded on try ${retry.attempts}` : "never succeeded",
      succeeded: retry.eventuallySucceeded,
    })),
    byTool: [...audit.byTool].sort((a, b) => b.calls - a.calls).map((tool) => ({ name: tool.name, callsText: formatCount(tool.calls), failedText: formatCount(tool.failed) })),
  };
  if (audit.toolCallsUnavailableReason !== undefined) vm.unavailableReason = audit.toolCallsUnavailableReason;
  return vm;
}

function dayPoints(daily: AuditRollup["daily"]): DayPoint[] {
  return daily.map((day) => {
    const label = formatDay(day.date) ?? day.date;
    if (day.toolCalls - day.unknown <= 0) return { label, value: null, text: UNKNOWN_TEXT };
    const failed = failedOf(day);
    return { label, value: failed, text: formatCount(failed) };
  });
}

function leftOutOf(rollup: AuditRollup): AuditRollupViewModel["leftOut"] {
  const count = rollup.sessionsWithUnknownToolCalls;
  if (count <= 0) return undefined;
  const reason = rollup.toolCallsUnavailableReason === undefined ? "" : ` (${rollup.toolCallsUnavailableReason})`;
  return { text: pluralize(count, "session"), note: `tool calls not recorded${reason}; not counted as 0` };
}

export function toAuditRollupViewModel(rollup: AuditRollup): AuditRollupViewModel {
  const noSessions = rollup.sessionCount === 0;
  const points = dayPoints(rollup.daily);
  const values = points.flatMap((point) => (point.value === null ? [] : [point.value]));
  const sessions = [...rollup.sessions].sort((a, b) => b.failed - a.failed);
  const period = periodText(rollup.since, rollup.until);
  const leftOut = leftOutOf(rollup);
  const vm: AuditRollupViewModel = {
    sessionsText: pluralize(rollup.sessionCount, "session"),
    tiles: {
      toolCalls: noSessions ? unknownTile("no session has recorded tool calls") : { text: formatCount(rollup.totals.toolCalls), known: true, note: `in ${pluralize(rollup.sessionCount, "session")} with known tool calls` },
      ...(({ failed, failureRate }) => ({ failed, failureRate }))(outcomeTiles(rollup.totals, rollup.failureRate, rollup.outcomeCoverage.known, noSessions)),
    },
    daily: { points, maxValue: values.length === 0 ? null : Math.max(...values) },
    categories: categoryBars(rollup.byFailureCategory, rollup.failureRate !== null),
    topCommands: rollup.topFailingCommands.map((command) => ({
      command: command.command,
      ...(command.failureCategory === undefined ? {} : { category: command.failureCategory }),
      failsText: formatCount(command.failures),
      sessionsText: formatCount(command.sessions),
    })),
    sessions: {
      rows: sessions.slice(0, MAX_SESSIONS).map((session) => {
        const started = formatDay(session.startedAt);
        return {
          title: session.title.trim() === "" ? "Untitled session" : session.title,
          ...(started === undefined ? {} : { startedText: started }),
          callsText: formatCount(session.toolCalls),
          failedText: formatCount(session.failed),
          unknownText: formatCount(session.unknown),
        };
      }),
      ...(sessions.length > MAX_SESSIONS ? { shownNote: `${MAX_SESSIONS} of ${sessions.length} shown` } : {}),
    },
  };
  if (period !== undefined) vm.periodText = period;
  if (leftOut !== undefined) vm.leftOut = leftOut;
  if (rollup.toolCallsUnavailableReason !== undefined) vm.unavailableReason = rollup.toolCallsUnavailableReason;
  return vm;
}
