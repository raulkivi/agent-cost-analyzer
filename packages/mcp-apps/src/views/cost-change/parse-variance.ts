// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostVariance } from "@agent-cost-analyzer/domain";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

// The host hands over structuredContent as unknown. This checks only the
// parts the view reads; the server has already validated the full shape
// against its output schema.
export function parseCostVariance(value: unknown): CostVariance | undefined {
  if (!isObject(value)) return undefined;
  if (!Array.isArray(value.currencies) || !Array.isArray(value.priceChanges) || !Array.isArray(value.providers)) return undefined;
  if (!isObject(value.periodA) || !isObject(value.periodB) || !isObject(value.notExplained)) return undefined;
  if (!isObject(value.notExplained.periodA) || !isObject(value.notExplained.periodB)) return undefined;
  if (typeof value.label !== "string" || typeof value.basis !== "string" || typeof value.pricing !== "string") return undefined;
  return value as unknown as CostVariance;
}
