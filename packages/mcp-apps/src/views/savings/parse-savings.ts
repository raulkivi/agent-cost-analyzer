// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SavingsViewInput } from "../../view-models/savings.js";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

// A row the view can read: the fields it formats without a guard. The server
// has already validated the full shape against its output schema (the zod
// schemas stay out of the bundle), so this checks only what a wrong shape
// would crash on.
function isRow(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.key === "string" &&
    typeof value.kind === "string" &&
    typeof value.subject === "string" &&
    typeof value.action === "string" &&
    typeof value.sessionsTotal === "number" &&
    Array.isArray(value.sessions) &&
    value.sessions.every((ref) => isRecord(ref) && typeof ref.providerId === "string" && typeof ref.sessionId === "string") &&
    isRecord(value.evidence) &&
    isRecord(value.perWeek) &&
    isRecord(value.perWindow) &&
    isRecord(value.coverage) &&
    Array.isArray(value.coverage.notAnalysed)
  );
}

export function parseSavingsReport(value: unknown): SavingsViewInput | undefined {
  if (!isRecord(value) || !isRecord(value.window) || typeof value.includeSimulated !== "boolean") return undefined;
  if (!Array.isArray(value.opportunities) || !Array.isArray(value.simulated) || !Array.isArray(value.notAnalysed)) return undefined;
  if (typeof value.opportunitiesTotal !== "number" || typeof value.simulatedTotal !== "number") return undefined;
  if (!value.opportunities.every(isRow) || !value.simulated.every(isRow)) return undefined;
  return value as unknown as SavingsViewInput;
}
