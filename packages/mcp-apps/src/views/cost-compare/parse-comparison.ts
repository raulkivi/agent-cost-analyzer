// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostComparison } from "@agent-cost-analyzer/domain";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

// The host hands over structuredContent as unknown. This checks only the
// parts the view reads; the server has already validated the full shape
// against its output schema.
export function parseComparison(value: unknown): CostComparison | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.groupBy !== "string" || typeof value.previousSince !== "string" || typeof value.previousUntil !== "string") return undefined;
  if (!Array.isArray(value.rows) || !Array.isArray(value.providers) || !isRecord(value.total)) return undefined;
  for (const row of value.rows) {
    if (!isRecord(row) || typeof row.key !== "string" || typeof row.label !== "string" || !isRecord(row.total) || !isRecord(row.previous)) return undefined;
  }
  return value as unknown as CostComparison;
}

// No row has a turn in either period: what a product with no projects answers
// for project ids (it keeps the rows and counts nothing), or an empty list.
export function hasNothingToCompare(comparison: CostComparison): boolean {
  return comparison.rows.every((row) => row.turns === 0 && row.previous.turns === 0);
}
