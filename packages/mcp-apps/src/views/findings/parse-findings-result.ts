// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { FindingsQueryResult } from "@agent-cost-analyzer/domain";

// The host hands over structuredContent as unknown. This checks only the
// parts the view reads; the server has already validated the full shape
// against its output schema.
export function parseFindingsResult(value: unknown): FindingsQueryResult | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const bySeverity = candidate.bySeverity;
  if (!Array.isArray(candidate.findings)) return undefined;
  if (typeof candidate.total !== "number") return undefined;
  if (typeof bySeverity !== "object" || bySeverity === null) return undefined;
  return value as FindingsQueryResult;
}
