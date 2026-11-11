// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Currency, Statement, StatementAnswer, StatementDiff, StatementLine, StatementTotal } from "@agent-cost-analyzer/domain";
import { NO_EARLIER_FIGURE, creditsFirst } from "./analysis-common.js";
import { UNKNOWN_TEXT, coverageNote, formatCount, formatDay, formatTokens, pluralize, valueView } from "./format.js";
import type { MeasureView } from "./format.js";
import { formatMoney, formatSignedMoney } from "./money.js";

// U14, a project's statement for a period (docs/plans/mcp-apps.md §2,
// §4.5). Pure: formats a get_statement result. Lines per basis, currency,
// channel and model; totals per currency; AI Credits before USD; unknown
// turns are counted with their reason, never as 0; an issued period shows
// the exact diff against its re-run. Statements are issued only in the app.

export interface StatementLineView {
  key: string;
  basisText: string;
  currency: Currency;
  channelText: string;
  model: string;
  turnsText: string;
  sessionsText: string;
  tokens: Record<"uncachedInput" | "cacheRead" | "cacheWrite" | "reasoning" | "output", MeasureView>;
  amountText: string;
  apiEquivalent: boolean; // subscription use priced at API rates
}

export interface StatementTotalView {
  currency: Currency;
  linesText: string;
  markupText: string;
  fixedText: string;
  totalText: string;
}

export interface GroupView {
  reason: string;
  turnsText: string;
  sessionsText: string;
}

export interface UnknownGroupView extends GroupView {
  amountText: typeof UNKNOWN_TEXT;
}

export interface DiffLineView {
  key: string;
  change: "added" | "removed" | "changed";
  labelText: string;
  issuedText: string;
  currentText: string;
  differenceText: string;
}

export interface DiffTotalView {
  currency: Currency;
  issuedText: string;
  currentText: string;
  differenceText: string;
}

export interface StatementDiffView {
  changed: boolean;
  lines: DiffLineView[];
  totals: DiffTotalView[];
  unknownTurnsText: string;
  sessionsText: string;
  inputsText: string[];
}

export interface StatementViewModel {
  title: string;
  client?: string;
  billingCode?: string;
  periodText: string;
  status: "draft" | "issued";
  statusText: string;
  conversionNote: string;
  lines: StatementLineView[];
  totals: StatementTotalView[];
  fixedLines: { label: string; amountText: string; currency: Currency }[];
  coverage: { text: string; partial: boolean };
  unknown: UnknownGroupView[];
  excluded: GroupView[];
  canIssue: { ok: boolean; reason?: string };
  issuedPeriods: string[];
  diff?: StatementDiffView;
}

function lineView(line: StatementLine): StatementLineView {
  const tokens = (value: number | null) => valueView(value, formatTokens);
  return {
    key: line.key,
    basisText: line.basis,
    currency: line.currency,
    channelText: line.channel ?? "no channel",
    model: line.model,
    turnsText: pluralize(line.turns, "turn"),
    sessionsText: pluralize(line.sessions, "session"),
    tokens: {
      uncachedInput: tokens(line.tokens.uncachedInput),
      cacheRead: tokens(line.tokens.cacheRead),
      cacheWrite: tokens(line.tokens.cacheWrite),
      reasoning: tokens(line.tokens.reasoning),
      output: tokens(line.tokens.output),
    },
    amountText: formatMoney(line.amount, line.currency),
    apiEquivalent: line.apiEquivalent,
  };
}

function totalView(total: StatementTotal): StatementTotalView {
  const money = (value: number) => formatMoney(value, total.currency);
  return { currency: total.currency, linesText: money(total.lines), markupText: money(total.markup), fixedText: money(total.fixed), totalText: money(total.total) };
}

function coverageView(coverage: Statement["coverage"]): StatementViewModel["coverage"] {
  const note = coverageNote(coverage.knownTurns, coverage.turns);
  return note === undefined
    ? { text: `all ${formatCount(coverage.turns)} turns known`, partial: false }
    : { text: note, partial: true };
}

function statusText(statement: Statement): string {
  if (statement.status === "draft") return "Draft";
  const day = formatDay(statement.issuedAt);
  return day === undefined ? "Issued" : `Issued ${day}`;
}

// The key is basis|currency|channel|model|priceVersionId.
function diffLabel(key: string): { labelText: string; currency: Currency } {
  const [basis = "", currency = "", channel = "", model = ""] = key.split("|");
  const channelText = channel === "" || channel === "null" ? "no channel" : channel;
  return { labelText: `${basis}, ${channelText}, ${model}`, currency: currency === "USD" ? "USD" : "AI_CREDITS" };
}

function diffLineView(line: StatementDiff["lines"][number]): DiffLineView {
  const { labelText, currency } = diffLabel(line.key);
  return {
    key: line.key,
    change: line.change,
    labelText,
    issuedText: line.issued === null ? NO_EARLIER_FIGURE : formatMoney(line.issued, currency),
    currentText: line.current === null ? "not in the re-run" : formatMoney(line.current, currency),
    differenceText: formatSignedMoney(line.difference, currency),
  };
}

function sessionsText(sessions: StatementDiff["sessions"]): string {
  const added = sessions.added.length === 0 ? "none added" : `${pluralize(sessions.added.length, "session")} added`;
  const removed = sessions.removed.length === 0 ? "none removed" : `${pluralize(sessions.removed.length, "session")} removed`;
  return `${added}, ${removed}`;
}

function diffView(diff: StatementDiff): StatementDiffView {
  return {
    changed: diff.changed,
    lines: diff.lines.map(diffLineView),
    totals: creditsFirst(diff.totals).map((total) => ({
      currency: total.currency,
      issuedText: formatMoney(total.issued, total.currency),
      currentText: formatMoney(total.current, total.currency),
      differenceText: formatSignedMoney(total.difference, total.currency),
    })),
    unknownTurnsText: `unknown turns ${formatCount(diff.unknownTurns.issued)} → ${formatCount(diff.unknownTurns.current)}`,
    sessionsText: sessionsText(diff.sessions),
    inputsText: [...(diff.inputs.priceBookChanged ? ["the price book changed"] : []), ...(diff.inputs.projectsFileChanged ? ["the projects file changed"] : [])],
  };
}

const group = (item: { reason: string; turns: number; sessions: number }): GroupView => ({
  reason: item.reason,
  turnsText: pluralize(item.turns, "turn"),
  sessionsText: pluralize(item.sessions, "session"),
});

export function toStatementViewModel(answer: StatementAnswer): StatementViewModel {
  const { statement } = answer;
  return {
    title: statement.project.name,
    ...(statement.project.client === undefined ? {} : { client: statement.project.client }),
    ...(statement.project.billingCode === undefined ? {} : { billingCode: statement.project.billingCode }),
    periodText: statement.period.label,
    status: statement.status,
    statusText: statusText(statement),
    conversionNote: statement.conversion,
    lines: creditsFirst(statement.lines).map(lineView),
    totals: creditsFirst(statement.totals).map(totalView),
    fixedLines: statement.fixedLines.map((fixed) => ({ label: fixed.label, amountText: formatMoney(fixed.amount, fixed.currency), currency: fixed.currency })),
    coverage: coverageView(statement.coverage),
    unknown: statement.unknown.map((item) => ({ ...group(item), amountText: UNKNOWN_TEXT })),
    excluded: statement.excluded.map(group),
    canIssue: answer.canIssue.reason === undefined ? { ok: answer.canIssue.ok } : { ok: answer.canIssue.ok, reason: answer.canIssue.reason },
    issuedPeriods: answer.issuedPeriods,
    ...(answer.diff === undefined ? {} : { diff: diffView(answer.diff) }),
  };
}
