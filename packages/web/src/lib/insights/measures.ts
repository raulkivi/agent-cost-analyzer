import {
  isFailedStatus,
  type FindingSeverity,
  type InsightFinding,
  type InsightSessionRow,
  type InsightToolCallRow,
  type InsightTurnRow,
} from "@agent-cost-analyzer/domain";

// KPI and chart maths over the *possible* rows of the current selection.
// Unknown figures (null) are never summed as 0: every total carries its
// coverage so the UI can say "k of n known" (constraint 6).

export interface Coverage {
  total: number;
  known: number;
  count: number;
}

export interface InsightRowsView {
  sessions: InsightSessionRow[];
  turns: InsightTurnRow[];
  toolCalls: InsightToolCallRow[];
  findings: InsightFinding[];
}

export function sumWithCoverage<T>(rows: readonly T[], pick: (row: T) => number | null): Coverage {
  let total = 0;
  let known = 0;
  for (const row of rows) {
    const value = pick(row);
    if (value !== null) {
      total += value;
      known += 1;
    }
  }
  return { total, known, count: rows.length };
}

export interface InsightKpis {
  sessions: number;
  turns: number;
  aiCredits: Coverage;
  output: Coverage;
  // cache read ÷ all input, over turns whose three input figures are known
  cacheHitRatio: number | null;
  toolCalls: number;
  failed: number;
  knownOutcomes: number;
  failureRate: number | null;
  securityFindings: number;
  securityFindingsBySeverity: Record<FindingSeverity, number>;
}

export function cacheHitRatio(turns: readonly InsightTurnRow[]): number | null {
  let read = 0;
  let input = 0;
  for (const turn of turns) {
    if (turn.uncachedInput !== null && turn.cacheWrite !== null && turn.cacheRead !== null) {
      read += turn.cacheRead;
      input += turn.uncachedInput + turn.cacheWrite + turn.cacheRead;
    }
  }
  return input > 0 ? read / input : null;
}

export function computeKpis(view: InsightRowsView): InsightKpis {
  const knownOutcomes = view.toolCalls.filter((call) => call.status !== "unknown");
  const failed = knownOutcomes.filter((call) => isFailedStatus(call.status)).length;
  const securityFindings = view.findings.filter((finding) => finding.kind === "security");
  const securityFindingsBySeverity: Record<FindingSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of securityFindings) {
    securityFindingsBySeverity[finding.severity] += 1;
  }
  return {
    sessions: view.sessions.length,
    turns: view.turns.length,
    aiCredits: sumWithCoverage(view.turns, (turn) => turn.aiCredits),
    output: sumWithCoverage(view.turns, (turn) => turn.output),
    cacheHitRatio: cacheHitRatio(view.turns),
    toolCalls: view.toolCalls.length,
    failed,
    knownOutcomes: knownOutcomes.length,
    failureRate: knownOutcomes.length > 0 ? failed / knownOutcomes.length : null,
    securityFindings: securityFindings.length,
    securityFindingsBySeverity,
  };
}

function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string | undefined): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key !== undefined) {
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
  }
  return groups;
}

export function aiCreditsByDay(
  sessions: readonly InsightSessionRow[],
  turns: readonly InsightTurnRow[],
): ({ date: string } & Coverage)[] {
  const dateOf = new Map(sessions.map((session) => [session.key, session.date]));
  return [...groupBy(turns, (turn) => dateOf.get(turn.sessionKey))]
    .map(([date, dayTurns]) => ({ date, ...sumWithCoverage(dayTurns, (turn) => turn.aiCredits) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export const TOKEN_KINDS = ["uncachedInput", "cacheWrite", "cacheRead", "reasoning", "output"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

export function tokensByModel(turns: readonly InsightTurnRow[]): ({ model: string } & Record<TokenKind, number>)[] {
  return [...groupBy(turns, (turn) => turn.model)]
    .map(([model, modelTurns]) => ({
      model,
      ...(Object.fromEntries(
        TOKEN_KINDS.map((kind) => [kind, sumWithCoverage(modelTurns, (turn) => turn[kind]).total]),
      ) as Record<TokenKind, number>),
    }))
    .sort((a, b) => totalTokens(b) - totalTokens(a));
}

function totalTokens(row: Record<TokenKind, number>): number {
  return TOKEN_KINDS.reduce((sum, kind) => sum + row[kind], 0);
}

export function toolCallsByTool(
  calls: readonly InsightToolCallRow[],
): { name: string; succeeded: number; failed: number; unknown: number }[] {
  return [...groupBy(calls, (call) => call.name)]
    .map(([name, toolCalls]) => ({
      name,
      succeeded: toolCalls.filter((call) => call.status === "success").length,
      failed: toolCalls.filter((call) => isFailedStatus(call.status)).length,
      unknown: toolCalls.filter((call) => call.status === "unknown").length,
    }))
    .sort((a, b) => b.succeeded + b.failed + b.unknown - (a.succeeded + a.failed + a.unknown) || a.name.localeCompare(b.name));
}

export function countBy<T>(rows: readonly T[], keyOf: (row: T) => string | undefined): { key: string; count: number }[] {
  return [...groupBy(rows, keyOf)]
    .map(([key, group]) => ({ key, count: group.length }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function topSessionsByCredits(
  sessions: readonly InsightSessionRow[],
  turns: readonly InsightTurnRow[],
  limit: number,
): { session: InsightSessionRow; aiCredits: Coverage; turns: number }[] {
  const turnsBySession = groupBy(turns, (turn) => turn.sessionKey);
  return sessions
    .map((session) => {
      const sessionTurns = turnsBySession.get(session.key) ?? [];
      return { session, aiCredits: sumWithCoverage(sessionTurns, (turn) => turn.aiCredits), turns: sessionTurns.length };
    })
    .sort((a, b) => b.aiCredits.total - a.aiCredits.total || b.turns - a.turns)
    .slice(0, limit);
}
