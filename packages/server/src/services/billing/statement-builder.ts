// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  AI_CREDIT_CONVERSION_NOTE,
  localDate,
  preferredCostFigure,
  STATEMENT_VERSION,
  USD_PER_AI_CREDIT,
  type Currency,
  type KnownCostFigure,
  type Project,
  type Statement,
  type StatementLine,
  type StatementPeriod,
} from "@agent-cost-analyzer/domain";
import type { CostCube, CostCubeRow } from "../cost-analysis/cost-cube.js";

// Phase 15 step 15.11 (docs/plans/cost-by-repository-and-project.md §8.5,
// D4, D6, D13, D14): one project's statement for one period, a pure
// function over the cost cube. A turn counts at its preferred basis (billed,
// else reported, else priced); a turn with no known cost is listed by reason
// and never summed as 0; subscription (API-equivalent) use is left off
// unless the project includes it (D4). Turns are placed by their calendar
// day in the statement's time zone (D6). Markup, fixed lines and a user
// currency come from the project (D13, D14).

export interface StatementInputs {
  project: Project;
  period: StatementPeriod;
  generatedAt: string;
  appVersion: string;
  priceBookHash: string;
  projectsFileHash: string;
}

const CURRENCIES: readonly Currency[] = ["AI_CREDITS", "USD"];
const TOKEN_TYPES = ["uncachedInput", "cacheRead", "cacheWrite", "reasoning", "output"] as const;
const PRICED_TYPES = ["uncachedInput", "cacheRead", "cacheWrite", "output"] as const;
const EXCLUDED_REASON = "subscription use priced as API-equivalent, left off unless the project includes it";

const round = (value: number) => Math.round(value * 1e9) / 1e9;
const round2 = (value: number) => Math.round(value * 100) / 100;

// The turn's calendar day where the statement is billed; a turn with no
// instant keeps its UTC date.
function dayOf(row: CostCubeRow, timeZone: string): string {
  return row.at ? localDate(new Date(row.at), timeZone) : row.date;
}

interface LineAccumulator {
  figure: KnownCostFigure;
  row: CostCubeRow;
  rows: CostCubeRow[];
  amount: number;
  parts: Record<(typeof PRICED_TYPES)[number], number>;
}

function lineKey(figure: KnownCostFigure, row: CostCubeRow): string {
  const version = figure.basis === "priced" ? (figure.priceVersionIds?.[0] ?? "") : "";
  return [figure.basis, figure.currency, row.channel ?? "", row.model, version].join("|");
}

function sumTokens(rows: readonly CostCubeRow[], type: (typeof TOKEN_TYPES)[number]): number | null {
  let total = 0;
  for (const row of rows) {
    const value = row[type];
    if (value === null) return null;
    total += value;
  }
  return total;
}

const sessionCount = (rows: readonly CostCubeRow[]) => new Set(rows.map((row) => row.sessionKey)).size;

function toLine(key: string, acc: LineAccumulator): StatementLine {
  const tokens = Object.fromEntries(TOKEN_TYPES.map((type) => [type, sumTokens(acc.rows, type)])) as StatementLine["tokens"];
  const priced = acc.figure.basis === "priced";
  const unitPrices = priced
    ? (Object.fromEntries(
        PRICED_TYPES.map((type) => {
          const count = tokens[type];
          return [type, count === null || count === 0 ? null : round((acc.parts[type] / count) * 1_000_000)];
        }),
      ) as NonNullable<StatementLine["unitPrices"]>)
    : null;
  return {
    key,
    basis: acc.figure.basis,
    currency: acc.figure.currency,
    channel: acc.row.channel,
    model: acc.row.model,
    priceVersionId: priced ? (acc.figure.priceVersionIds?.[0] ?? null) : null,
    sessions: sessionCount(acc.rows),
    turns: acc.rows.length,
    tokens,
    unitPrices,
    amount: round(acc.amount),
    apiEquivalent: acc.figure.apiEquivalent === true,
  };
}

function groups(rows: readonly CostCubeRow[], reasonOf: (row: CostCubeRow) => string) {
  const byReason = new Map<string, CostCubeRow[]>();
  for (const row of rows) byReason.set(reasonOf(row), [...(byReason.get(reasonOf(row)) ?? []), row]);
  return [...byReason]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, members]) => ({ reason, turns: members.length, sessions: sessionCount(members) }));
}

export function buildStatement(cube: CostCube, inputs: StatementInputs): Statement {
  const { project, period } = inputs;
  const include = project.includeSubscriptionUse === true;
  const rows = cube.rows.filter((row) => row.projectId === project.id && dayOf(row, period.timeZone) >= period.since && dayOf(row, period.timeZone) <= period.until);

  const lines = new Map<string, LineAccumulator>();
  const unknownReasons = new Map<CostCubeRow, string>();
  const excludedRows: CostCubeRow[] = [];
  for (const row of rows) {
    const figure = preferredCostFigure(row.cost);
    if (!figure.known) {
      unknownReasons.set(row, figure.reason);
      continue;
    }
    if (figure.apiEquivalent === true && !include) {
      excludedRows.push(row);
      continue;
    }
    const key = lineKey(figure, row);
    const acc = lines.get(key) ?? { figure, row, rows: [], amount: 0, parts: { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 } };
    acc.rows.push(row);
    acc.amount += figure.amount;
    for (const type of PRICED_TYPES) acc.parts[type] += figure.byTokenType?.[type] ?? 0;
    lines.set(key, acc);
  }
  const statementLines = [...lines].sort(([a], [b]) => a.localeCompare(b)).map(([key, acc]) => toLine(key, acc));

  const rates = project.rates ?? {};
  const percent = rates.markupPercent ?? 0;
  const fixedLines = rates.fixedLines ?? [];
  const present = CURRENCIES.filter((currency) => statementLines.some((line) => line.currency === currency) || fixedLines.some((line) => line.currency === currency));
  const markup = present.map((currency) => {
    const base = round(statementLines.filter((line) => line.currency === currency).reduce((sum, line) => sum + line.amount, 0));
    return { currency, base, amount: round((base * percent) / 100) };
  });
  const totals = present.map((currency) => {
    const linesTotal = markup.find((entry) => entry.currency === currency)!.base;
    const markupAmount = markup.find((entry) => entry.currency === currency)!.amount;
    const fixed = round(fixedLines.filter((line) => line.currency === currency).reduce((sum, line) => sum + line.amount, 0));
    return { currency, lines: linesTotal, markup: markupAmount, fixed, total: round(linesTotal + markupAmount + fixed) };
  });
  const usdInAll = totals.reduce((sum, total) => sum + (total.currency === "USD" ? total.total : total.total * USD_PER_AI_CREDIT), 0);
  const userCurrency = rates.currency
    ? {
        code: rates.currency.code,
        perUsd: rates.currency.perUsd,
        total: round2(usdInAll * rates.currency.perUsd),
        conversion: `1 USD = ${rates.currency.perUsd} ${rates.currency.code} (the project's fixed rate); 1 AI Credit = $0.01.`,
      }
    : undefined;

  const sessions = new Map<string, { providerId: string; sessionId: string; title?: string }>();
  for (const row of rows) sessions.set(row.sessionKey, { providerId: row.providerId, sessionId: row.sessionId, ...(row.sessionTitle ? { title: row.sessionTitle } : {}) });

  return {
    version: STATEMENT_VERSION,
    status: "draft",
    generatedAt: inputs.generatedAt,
    project: {
      id: project.id,
      name: project.name,
      ...(project.client !== undefined ? { client: project.client } : {}),
      ...(project.billingCode !== undefined ? { billingCode: project.billingCode } : {}),
    },
    period,
    includeSubscriptionUse: include,
    conversion: AI_CREDIT_CONVERSION_NOTE,
    lines: statementLines,
    unknown: groups([...unknownReasons.keys()], (row) => unknownReasons.get(row)!),
    excluded: excludedRows.length > 0 ? [{ reason: EXCLUDED_REASON, turns: excludedRows.length, sessions: sessionCount(excludedRows) }] : [],
    ...(rates.markupPercent !== undefined ? { markupPercent: percent } : {}),
    markup,
    fixedLines,
    totals,
    ...(userCurrency ? { userCurrency } : {}),
    coverage: { turns: rows.length, knownTurns: rows.length - unknownReasons.size },
    provenance: {
      appVersion: inputs.appVersion,
      priceBookHash: inputs.priceBookHash,
      projectsFileHash: inputs.projectsFileHash,
      priceVersionIds: [...new Set(statementLines.flatMap((line) => (line.priceVersionId ? [line.priceVersionId] : [])))].sort(),
      sessions: [...sessions.values()].sort((a, b) => a.providerId.localeCompare(b.providerId) || a.sessionId.localeCompare(b.sessionId)),
    },
  };
}
