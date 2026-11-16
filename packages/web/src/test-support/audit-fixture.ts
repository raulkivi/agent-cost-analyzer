// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { AuditRollup, SessionAudit, ToolCallRecord } from "@agent-cost-analyzer/domain";

function bash(command: string, program: string, outcome: ToolCallRecord["outcome"]): ToolCallRecord {
  return { name: "Bash", kind: "shell", argsSummary: command, shell: { command, program }, outcome };
}

// Mirrors the server's real-capture Claude Code fixture in shape (a few of
// its calls), so UI tests exercise realistic categories and evidence.
export function makeSessionAudit(overrides: Partial<SessionAudit> = {}): SessionAudit {
  return {
    sessionId: "s1",
    providerId: "claude-code",
    title: "Bash failure audit",
    totals: { toolCalls: 4, succeeded: 1, failed: 2, interrupted: 1, denied: 0, unknown: 0 },
    failureRate: 0.75,
    byTool: [{ name: "Bash", calls: 4, failed: 3, totalDurationMs: 4200 }],
    byShellProgram: [
      { program: "definitely-not-installed-tool", calls: 2, failed: 2 },
      { program: "sleep", calls: 1, failed: 1 },
      { program: "ls", calls: 1, failed: 0 },
    ],
    byFailureCategory: [
      { category: "command-not-found", count: 2 },
      { category: "timeout", count: 1 },
    ],
    perTurn: [
      { turnIndex: 0, succeeded: 1, failed: 1, interrupted: 0, denied: 0, unknown: 0 },
      { turnIndex: 1, succeeded: 0, failed: 1, interrupted: 1, denied: 0, unknown: 0 },
    ],
    calls: [
      { turnIndex: 0, call: bash("ls", "ls", { status: "success" }) },
      {
        turnIndex: 0,
        call: bash("definitely-not-installed-tool --version", "definitely-not-installed-tool", {
          status: "error",
          exitCode: 127,
          failureCategory: "command-not-found",
          classificationEvidence: {
            ruleId: "text.command-not-found",
            excerpt: "/bin/bash: line 1: definitely-not-installed-tool: command not found",
          },
        }),
      },
      {
        turnIndex: 1,
        call: bash("sleep 8", "sleep", {
          status: "interrupted",
          exitCode: 143,
          failureCategory: "timeout",
          classificationEvidence: { ruleId: "text.timeout", excerpt: "Command timed out after 2s" },
        }),
      },
      {
        turnIndex: 1,
        call: bash("definitely-not-installed-tool --version", "definitely-not-installed-tool", {
          status: "error",
          exitCode: 127,
          failureCategory: "command-not-found",
          classificationEvidence: { ruleId: "text.command-not-found", excerpt: "command not found" },
        }),
      },
    ],
    retries: [
      { command: "definitely-not-installed-tool --version", attempts: 2, eventuallySucceeded: false, turnIndexes: [0, 1] },
    ],
    failureRecoveryCost: {
      recoveryRounds: 3,
      affectedTurns: [0, 1],
      affectedTurnsOutputTokens: { known: true, value: 900 },
      affectedTurnsInputTokens: { known: true, value: 42_000 },
    },
    outcomeCoverage: { known: 4, unknown: 0, unknownReasons: [] },
    ...overrides,
  };
}

export const HOSTILE_LABEL = "<img src=x onerror=alert(1)>Explore";

function subagentCall(runId: string, label: string, depth: number, name: string, command: string, outcome: ToolCallRecord["outcome"]) {
  return {
    ...bash(command, name, outcome),
    origin: { kind: "subagent" as const, runId, label, depth, ...(depth > 1 ? { parentRunId: "run-a" } : {}) },
  };
}

const totalsOf = (toolCalls: number, failed: number) => ({
  toolCalls,
  succeeded: toolCalls - failed,
  failed,
  interrupted: 0,
  denied: 0,
  unknown: 0,
});

// Step 10.20: main-agent calls plus a read run (hostile label), a nested run
// flagged with known totals (D12), and an unread run with its reason.
export function makeSubagentAudit(overrides: Partial<SessionAudit> = {}): SessionAudit {
  const base = makeSessionAudit();
  return {
    ...base,
    totals: { ...totalsOf(7, 3), interrupted: 1, failed: 2, succeeded: 4, canceled: 1 },
    calls: [
      ...base.calls,
      { turnIndex: 1, call: subagentCall("run-a", HOSTILE_LABEL, 1, "grep", "grep -rn foo .", { status: "success" }) },
      {
        turnIndex: 1,
        call: subagentCall("run-b", "searchSubagent", 2, "cat", "cat missing.txt", {
          status: "error",
          exitCode: 1,
          failureCategory: "file-not-found",
          classificationEvidence: { ruleId: "text.file-not-found", excerpt: "No such file" },
        }),
      },
      { turnIndex: 1, call: subagentCall("run-a", HOSTILE_LABEL, 1, "ls", "ls", { status: "canceled" }) },
    ],
    byOrigin: { main: totalsOf(4, 3), subagents: { ...totalsOf(3, 1), runs: 3 } },
    subagentRuns: [
      { runId: "run-a", label: HOSTILE_LABEL, depth: 1, turnIndex: 1, totals: totalsOf(2, 0), failureRate: 0 },
      {
        runId: "run-b",
        label: "searchSubagent",
        depth: 2,
        parentRunId: "run-a",
        turnIndex: 1,
        totals: totalsOf(1, 1),
        failureRate: 1,
        unreadReason: "The run's start call is missing from the log.",
      },
      {
        runId: "run-c",
        label: "Review",
        depth: 1,
        turnIndex: 0,
        totals: null,
        failureRate: null,
        unreadReason: "The subagent log is missing.",
      },
    ],
    ...overrides,
  };
}

export function makeAuditRollup(overrides: Partial<AuditRollup> = {}): AuditRollup {
  return {
    providerId: "claude-code",
    sessionCount: 2,
    sessionsWithUnknownToolCalls: 0,
    sessionsWithUnreadSubagentRuns: 0,
    totals: { toolCalls: 10, succeeded: 6, failed: 3, interrupted: 1, denied: 0, unknown: 0 },
    failureRate: 0.4,
    byTool: [{ name: "Bash", calls: 10, failed: 4 }],
    byShellProgram: [
      { program: "npm", calls: 6, failed: 2 },
      { program: "git", calls: 4, failed: 2 },
    ],
    byFailureCategory: [
      { category: "wrong-directory", count: 2 },
      { category: "git-state", count: 2 },
    ],
    topFailingCommands: [
      { command: "npm run build", program: "npm", failures: 2, sessions: 2, failureCategory: "wrong-directory" },
      { command: "git push", program: "git", failures: 2, sessions: 1, failureCategory: "git-state" },
    ],
    daily: [
      { date: "2026-09-26", toolCalls: 4, succeeded: 3, failed: 1, interrupted: 0, denied: 0, unknown: 0 },
      { date: "2026-09-27", toolCalls: 6, succeeded: 3, failed: 2, interrupted: 1, denied: 0, unknown: 0 },
    ],
    sessions: [
      { sessionId: "a", title: "Fix the build", startedAt: "2026-09-27T08:00:00.000Z", toolCalls: 6, failed: 3, unknown: 0 },
      { sessionId: "b", title: "Push release", startedAt: "2026-09-26T08:00:00.000Z", toolCalls: 4, failed: 1, unknown: 0 },
    ],
    outcomeCoverage: { known: 10, unknown: 0, unknownReasons: [] },
    ...overrides,
  };
}

// Step 10.20: session "a" has read and unread subagent runs, "b" read runs
// only, "c" is from a provider with no subagent concept.
export function makeSubagentRollup(overrides: Partial<AuditRollup> = {}): AuditRollup {
  const base = makeAuditRollup();
  return {
    ...base,
    sessionsWithUnreadSubagentRuns: 1,
    byOrigin: { main: totalsOf(7, 3), subagents: { ...totalsOf(3, 1), runs: 3 } },
    sessions: [
      { sessionId: "a", title: "Fix the build", startedAt: "2026-09-27T08:00:00.000Z", toolCalls: 6, failed: 3, unknown: 0, subagentCalls: 2, unreadSubagentRuns: 1 },
      { sessionId: "b", title: HOSTILE_LABEL, startedAt: "2026-09-26T08:00:00.000Z", toolCalls: 4, failed: 1, unknown: 0, subagentCalls: 1, unreadSubagentRuns: 0 },
      { sessionId: "c", title: "A pi session", startedAt: "2026-09-25T08:00:00.000Z", toolCalls: 1, failed: 0, unknown: 0 },
    ],
    ...overrides,
  };
}
