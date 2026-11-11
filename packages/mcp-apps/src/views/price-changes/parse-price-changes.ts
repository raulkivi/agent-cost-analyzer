// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { PriceChangeList } from "@agent-cost-analyzer/domain";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function drawable(change: unknown): boolean {
  if (!isObject(change)) return false;
  if (typeof change.date !== "string" || typeof change.modelId !== "string" || typeof change.channel !== "string") return false;
  if (change.kind === "documented") return Array.isArray(change.changes) && Array.isArray(change.sourceIds);
  if (change.kind === "observed") return Array.isArray(change.weeks) && typeof change.percent === "number" && (change.direction === "above" || change.direction === "below");
  return false;
}

// The host hands over structuredContent as unknown. This checks only what the
// view reads; the server has already validated the full shape against its
// output schema.
export function parsePriceChanges(value: unknown): PriceChangeList | undefined {
  if (!isObject(value) || !Array.isArray(value.changes) || !Array.isArray(value.providers)) return undefined;
  if (!value.changes.every(drawable)) return undefined;
  return value as unknown as PriceChangeList;
}
