// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostSeries, ProjectCost } from "@agent-cost-analyzer/domain";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

// The host hands over structuredContent as unknown. This checks only the
// parts the view reads; the server has already validated the full shape
// against its output schema.
export function parseCostSeries(value: unknown): CostSeries | ProjectCost | undefined {
  if (!isRecord(value)) return undefined;
  if (!Array.isArray(value.points) || !Array.isArray(value.byVendor) || !Array.isArray(value.priceChanges) || !Array.isArray(value.observedChanges)) return undefined;
  if (!isRecord(value.total) || !isRecord(value.totals) || typeof value.bucket !== "string") return undefined;
  if ("project" in value) {
    if (!isRecord(value.project) || typeof value.project.id !== "string") return undefined;
    if (!Array.isArray(value.topSessions) || !Array.isArray(value.byTokenType) || !Array.isArray(value.byRepository)) return undefined;
    return value as unknown as ProjectCost;
  }
  return value as unknown as CostSeries;
}
