// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostRollup } from "@agent-cost-analyzer/domain";

// The host hands over structuredContent as unknown. This checks only the
// parts the view reads; the server has already validated the full shape
// against its output schema.
export function parseCostRollup(value: unknown): CostRollup | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.daily) || !Array.isArray(candidate.byModel) || !Array.isArray(candidate.byProvider) || !Array.isArray(candidate.topSessions)) return undefined;
  if (typeof candidate.totals !== "object" || candidate.totals === null) return undefined;
  if (typeof candidate.sessionCount !== "number" && candidate.sessionCount !== null) return undefined;
  return value as CostRollup;
}
