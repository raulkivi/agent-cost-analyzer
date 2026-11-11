// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostEstimate } from "@agent-cost-analyzer/domain";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

// Checks only what the view reads; the server has validated the full shape.
export function parseCostEstimate(value: unknown): CostEstimate | undefined {
  if (!isObject(value) || value.label !== "estimate") return undefined;
  if (!isObject(value.target) || !isObject(value.window) || !isObject(value.history) || !isObject(value.runRate)) return undefined;
  if (typeof value.planned !== "number" || (value.unit !== "activeDays" && value.unit !== "sessions")) return undefined;
  if (value.range !== null && !(isObject(value.range) && typeof value.range.p50 === "number" && typeof value.range.p90 === "number")) return undefined;
  return value as unknown as CostEstimate;
}
