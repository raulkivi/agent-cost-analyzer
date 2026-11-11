// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { AuditRollup, SessionAudit } from "@agent-cost-analyzer/domain";

// The host hands over structuredContent as unknown. This checks only the
// parts the view reads; the server has already validated the full shape
// against its output schema. `sessionId` tells a session audit from a rollup.

export type ParsedAudit = { kind: "session"; audit: SessionAudit } | { kind: "rollup"; rollup: AuditRollup };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export function parseAuditResult(value: unknown): ParsedAudit | undefined {
  if (!isObject(value)) return undefined;
  const common = isObject(value.totals) && isObject(value.outcomeCoverage) && Array.isArray(value.byTool) && Array.isArray(value.byFailureCategory);
  if (!common) return undefined;
  if (typeof value.sessionId === "string") {
    if (!Array.isArray(value.retries) || !Array.isArray(value.perTurn) || !isObject(value.failureRecoveryCost)) return undefined;
    return { kind: "session", audit: value as unknown as SessionAudit };
  }
  if (!Array.isArray(value.daily) || !Array.isArray(value.sessions) || !Array.isArray(value.topFailingCommands) || typeof value.sessionCount !== "number") return undefined;
  return { kind: "rollup", rollup: value as unknown as AuditRollup };
}
