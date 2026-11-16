// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  unavailableTokenCount,
  type Session,
  type ToolCallRecord,
  type ToolCallStatus,
  type Turn,
} from "@agent-cost-analyzer/domain";
import { buildAuditRollup } from "./audit-rollup-builder.js";
import { buildSessionAudit } from "./session-audit-builder.js";

// Step 10.20 D14: a canceled call (a user stop) is not a failure in rates,
// categories, retries or top failing commands, but stays visible: it is in
// the call list and has its own count in every totals block.

const known = (value: number) => ({ known: true as const, value });

function call(command: string, status: ToolCallStatus, runId?: string): ToolCallRecord {
  return {
    name: "run_in_terminal",
    kind: "shell",
    argsSummary: command,
    shell: { command, program: command.split(" ")[0] },
    outcome: status === "error" ? { status, failureCategory: "timeout" } : status === "unknown" ? { status, reason: "n/a" } : { status },
    roundIndex: 0,
    ...(runId ? { origin: { kind: "subagent" as const, runId, label: "Explore", depth: 1 } } : {}),
  };
}

function session(toolCalls: ToolCallRecord[]): Session {
  const turn: Turn = {
    index: 1,
    userMessage: "",
    assistantResponse: "",
    toolCalls,
    explanation: "",
    usage: {
      uncachedInput: known(1),
      cacheWrite: known(0),
      cacheRead: known(0),
      tool: unavailableTokenCount("n/a"),
      vision: unavailableTokenCount("n/a"),
      reasoning: unavailableTokenCount("n/a"),
      output: known(1),
      costAiCredits: unavailableTokenCount("n/a"),
      model: "m",
    },
  };
  return {
    id: "s",
    mode: "analyze",
    providerId: "vscode-copilot",
    title: "s",
    model: "m",
    turns: [turn],
    turnCount: 1,
    costAiCredits: unavailableTokenCount("n/a"),
    usageDataAvailable: true,
  };
}

describe("canceled calls in the audit (D14)", () => {
  const calls = [
    call("npm test", "canceled"),
    call("npm test", "canceled", "r1"),
    call("npm test", "success"),
    call("git push", "error"),
  ];
  const audit = buildSessionAudit(session(calls));

  it("counts them in their own bucket, main and subagent, so main + subagents = totals", () => {
    expect(audit.totals).toMatchObject({ toolCalls: 4, succeeded: 1, failed: 1, canceled: 2, unknown: 0 });
    expect(audit.byOrigin?.main).toMatchObject({ toolCalls: 3, canceled: 1 });
    expect(audit.byOrigin?.subagents).toMatchObject({ toolCalls: 1, canceled: 1 });
  });

  it("leaves them out of the failure rate, the categories, the retries and the failing commands", () => {
    expect(audit.failureRate).toBe(0.5);
    expect(audit.byFailureCategory).toEqual([{ category: "timeout", count: 1 }]);
    expect(audit.retries).toEqual([]);
    expect(buildAuditRollup([audit], {}).topFailingCommands.map((row) => row.command)).toEqual(["git push"]);
  });

  it("keeps them visible in the call list with their status", () => {
    expect(audit.calls.filter((entry) => entry.call.outcome?.status === "canceled")).toHaveLength(2);
  });

  it("sums them across sessions in the rollup without lowering the failure rate", () => {
    const rollup = buildAuditRollup([audit, audit], {});
    expect(rollup.totals.canceled).toBe(4);
    expect(rollup.failureRate).toBe(0.5);
    expect(rollup.byOrigin?.subagents.canceled).toBe(2);
  });

  it("gives a session of only canceled calls no failure rate (null, never 0%)", () => {
    expect(buildSessionAudit(session([call("sleep 9", "canceled")])).failureRate).toBeNull();
  });
});
