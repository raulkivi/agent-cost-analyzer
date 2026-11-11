// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { StatementAnswer } from "@agent-cost-analyzer/domain";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

// The host hands over structuredContent as unknown. This checks only what
// the view reads; the server has validated the full shape.
export function parseStatementAnswer(value: unknown): StatementAnswer | undefined {
  if (!isObject(value) || !isObject(value.statement) || !isObject(value.canIssue) || !Array.isArray(value.issuedPeriods)) return undefined;
  const { statement } = value;
  if (!Array.isArray(statement.lines) || !Array.isArray(statement.totals) || !Array.isArray(statement.unknown) || !Array.isArray(statement.excluded) || !Array.isArray(statement.fixedLines)) return undefined;
  if (!isObject(statement.project) || !isObject(statement.period) || !isObject(statement.coverage)) return undefined;
  if (statement.status !== "draft" && statement.status !== "issued") return undefined;
  return value as unknown as StatementAnswer;
}
