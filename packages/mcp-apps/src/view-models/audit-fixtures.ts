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

const outcome = (toolCalls: number, failed: number, unknown: number, extra: { canceled?: number } = {}) => ({
  toolCalls,
  succeeded: toolCalls - failed - unknown - (extra.canceled ?? 0),
  failed,
  interrupted: 0,
  denied: 0,
  unknown,
  ...extra,
});

interface SubagentAuditOptions {
  unread?: boolean; // adds two unread runs: a missing log, and a tool that writes none
  flagged?: boolean; // the Plan run keeps its totals and carries a flag (D12)
  nested?: boolean; // adds task-Planner and its depth-2 child
  byTime?: boolean; // the second Explore run was placed by time (10.19 D5)
}

// Invented session of the ST2 boards: 214 calls, 131 by the main agent and 83
// by three read subagent runs; optionally two more runs unread.
export function subagentAudit(options: SubagentAuditOptions = {}): SessionAudit {
  const run = (runId: string, label: string, turnIndex: number, totals: ReturnType<typeof outcome> | null, extra: Record<string, unknown> = {}) => ({
    runId,
    label,
    depth: 1,
    turnIndex,
    totals,
    failureRate: totals === null ? null : (totals.failed + totals.interrupted + totals.denied) / (totals.toolCalls - totals.unknown),
    ...extra,
  });
  const runs = [
    run("run-explore-1", "Agent-Explore", 3, outcome(41, 4, 1)),
    run("run-plan", "Agent-Plan", 3, outcome(22, 1, 0), options.flagged === true ? { unreadReason: "The call that started this run is missing from the log." } : {}),
    run("run-explore-2", "Agent-Explore", 9, outcome(20, 4, 0), options.byTime === true ? { matchedByTime: true } : {}),
    ...(options.nested === true ? [run("run-planner", "task-Planner", 5, outcome(1, 0, 0)), run("run-search", "search_code_subagent", 5, outcome(1, 0, 0), { depth: 2, parentRunId: "run-planner" })] : []),
    ...(options.unread === true
      ? [
          run("run-review", "runSubagent-Review", 7, null, { unreadReason: "The subagent log runSubagent-Review this turn started is missing, so its tool calls are unknown." }),
          run("run-explore-tool", "searchSubagent", 10, null, { unreadReason: "This subagent tool writes no log the analyzer reads." }),
        ]
      : []),
  ];
  return sessionAudit({
    sessionId: "9d41b7e2",
    title: "Refactor the export module",
    totals: outcome(214, 20, 6),
    failureRate: 20 / 208,
    outcomeCoverage: { known: 208, unknown: 6, unknownReasons: [] },
    byOrigin: { main: outcome(131, 11, 5), subagents: { ...outcome(83, 9, 1), runs: runs.length } },
    subagentRuns: runs,
  });
}
