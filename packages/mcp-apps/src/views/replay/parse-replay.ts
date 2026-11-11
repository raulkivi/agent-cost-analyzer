// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SessionReplay, SessionReplayComparison } from "@agent-cost-analyzer/domain";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

// The host hands over structuredContent as unknown. This checks only the
// parts the view reads; the server has already validated the full shape
// against its output schema (the zod schemas stay out of the bundle).
export function parseSessionReplay(value: unknown): SessionReplay | undefined {
  if (!isRecord(value) || typeof value.sessionId !== "string" || typeof value.model !== "string") return undefined;
  if (!Array.isArray(value.turns) || !isRecord(value.totals) || !isRecord(value.coverage) || !Array.isArray(value.assumptions)) return undefined;
  return value as unknown as SessionReplay;
}

export function parseSessionComparison(value: unknown): SessionReplayComparison | undefined {
  if (!isRecord(value) || typeof value.sessionId !== "string" || !Array.isArray(value.entries) || !isRecord(value.measured)) return undefined;
  return value as unknown as SessionReplayComparison;
}

export function parseReplay(value: unknown): SessionReplay | SessionReplayComparison | undefined {
  return parseSessionComparison(value) ?? parseSessionReplay(value);
}
