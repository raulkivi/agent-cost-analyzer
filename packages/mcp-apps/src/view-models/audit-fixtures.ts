// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { auditRollupSchema, sessionAuditSchema } from "@agent-cost-analyzer/domain";
import type { AuditRollup, SessionAudit } from "@agent-cost-analyzer/domain";

// Fixtures for the U4 view models: invented sessions, parsed with the domain
// schemas so they can't drift from what the tools send.

const known = (value: number) => ({ known: true, value });

export function sessionAudit(overrides: Partial<SessionAudit> = {}): SessionAudit {
  return sessionAuditSchema.parse({
    sessionId: "5b91d0c4",
    providerId: "vscode",
    title: "Add retry to export job",
    startedAt: "2026-11-09T16:40:00Z",
    totals: { toolCalls: 118, succeeded: 97, failed: 11, interrupted: 2, denied: 1, unknown: 7 },
    failureRate: 14 / 111,
    byTool: [
      { name: "read_file", calls: 31, failed: 2 },
      { name: "run_in_terminal", calls: 64, failed: 9 },
      { name: "apply_patch", calls: 14, failed: 1 },
      { name: "grep_search", calls: 9, failed: 2 },
    ],
    byShellProgram: [],
    byFailureCategory: [
      { category: "command-not-found", count: 3 },
      { category: "test-or-build-failure", count: 5 },
      { category: "file-not-found", count: 2 },
      { category: "timeout", count: 2 },
      { category: "wrong-directory", count: 1 },
      { category: "user-rejected", count: 1 },
    ],
    perTurn: Array.from({ length: 42 }, (_, turnIndex) => ({ turnIndex, succeeded: 2, failed: 0, interrupted: 0, denied: 0, unknown: 0 })),
    calls: [],
    retries: [
      { command: "npm test -- exporter", attempts: 4, eventuallySucceeded: true, turnIndexes: [4, 7] },
      { command: "docker compose up -d db", attempts: 2, eventuallySucceeded: false, turnIndexes: [12] },
    ],
    failureRecoveryCost: {
      recoveryRounds: 12,
      affectedTurns: [4, 7, 12, 13, 19, 22, 27, 31, 38],
      affectedTurnsOutputTokens: known(6240),
      affectedTurnsInputTokens: known(1_284_500),
    },
    outcomeCoverage: { known: 111, unknown: 7, unknownReasons: [] },
    ...overrides,
  });
}

export function auditRollup(overrides: Partial<AuditRollup> = {}): AuditRollup {
  return auditRollupSchema.parse({
    providerId: "vscode",
    since: "2026-10-19",
    until: "2026-11-01",
    sessionCount: 20,
    sessionsWithUnknownToolCalls: 3,
    totals: { toolCalls: 2147, succeeded: 1872, failed: 187, interrupted: 21, denied: 18, unknown: 49 },
    failureRate: 226 / 2098,
    byTool: [{ name: "run_in_terminal", calls: 900, failed: 150 }],
    byShellProgram: [],
    byFailureCategory: [
      { category: "command-not-found", count: 37 },
      { category: "test-or-build-failure", count: 88 },
      { category: "timeout", count: 24 },
    ],
    topFailingCommands: [
      { command: "npm test", program: "npm", failures: 41, sessions: 9, failureCategory: "test-or-build-failure" },
      { command: "python3 scripts/seed.py", failures: 12, sessions: 3 },
    ],
    daily: [
      { date: "2026-10-19", toolCalls: 100, succeeded: 90, failed: 8, interrupted: 1, denied: 0, unknown: 1 },
      { date: "2026-10-20", toolCalls: 40, succeeded: 0, failed: 0, interrupted: 0, denied: 0, unknown: 40 },
      { date: "2026-10-21", toolCalls: 80, succeeded: 60, failed: 15, interrupted: 2, denied: 1, unknown: 2 },
    ],
    sessions: [
      { sessionId: "a1", title: "Add retry to export job", startedAt: "2026-10-20T10:00:00Z", toolCalls: 118, failed: 14, unknown: 7 },
      { sessionId: "b2", title: "Fix flaky invoice test", toolCalls: 203, failed: 31, unknown: 0 },
    ],
    outcomeCoverage: { known: 2098, unknown: 49, unknownReasons: [] },
    ...overrides,
  });
}
