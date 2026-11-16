// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { savingsOpportunitySchema, type CostFigure, type ToolCallRecord } from "@agent-cost-analyzer/domain";
import { session as auditSession, shell } from "../../../test-support/audit-fakes.js";
import { ANTHROPIC, savingsInput, session, sessionInput, tool, withRounds } from "../../../test-support/savings-fakes.js";
import { buildSessionAudit } from "../../tool-audit/session-audit-builder.js";
import { FailedCallsDetector } from "./failed-calls-detector.js";
import { UnusedToolsDetector } from "./unused-tools-detector.js";

// Step 10.20 ST10, D7 and D14: the savings detectors read main-agent calls
// only, say how many subagent calls they left out, and never count a
// canceled call (a user stop) as a failed one.

const priced = (amount: number): CostFigure => ({ known: true, amount, currency: "USD", basis: "priced", priceVersionIds: ["anthropic-api:m:2026-10-01"] });

const bySubagent = (call: ToolCallRecord): ToolCallRecord => ({
  ...call,
  origin: { kind: "subagent", runId: "run-1", label: "runSubagent-Explore", depth: 1 },
});
const canceled = (command: string): ToolCallRecord => ({ ...shell(command, "success"), outcome: { status: "canceled" } });

function failedCallsInput(calls: ToolCallRecord[][]) {
  const s = auditSession("s1", "2026-10-15T12:00:00Z", calls);
  return {
    providerId: "claude-code",
    session: s,
    channel: ANTHROPIC,
    audit: buildSessionAudit(s),
    turnCosts: new Map(calls.map((_, index) => [index, priced(0.1)])),
  };
}

describe("FailedCallsDetector: main agent only (D7)", () => {
  const failing = () => shell("rg foo src", "error", "command-not-found");
  const detector = new FailedCallsDetector();

  it("does not count a subagent's failures, and says how many subagent calls it left out", () => {
    // Two main failures reach the minimum of 2; the three subagent failures would make 5.
    const input = failedCallsInput([[failing(), failing(), bySubagent(failing()), bySubagent(failing())], [bySubagent(failing())]]);
    const [rg] = detector.detect(savingsInput([input])).opportunities;

    expect(rg?.evidence.occurrences).toBe(2);
    expect(rg?.actionParams).toMatchObject({ calls: 2 });
    expect(rg?.coverage).toEqual({
      sessionsInWindow: 1,
      sessionsAnalysed: 1,
      notAnalysed: [{ reason: "3 subagent tool calls not analyzed: this saving reads main-agent calls only.", sessions: 1 }],
    });
    expect(savingsOpportunitySchema.safeParse(rg).success).toBe(true);
  });

  it("reports no opportunity when only the subagent failed repeatedly", () => {
    const input = failedCallsInput([[bySubagent(failing()), bySubagent(failing()), bySubagent(failing())]]);
    expect(detector.detect(savingsInput([input])).opportunities).toEqual([]);
  });

  it("adds no note when the row's sessions held no subagent calls", () => {
    const [rg] = detector.detect(savingsInput([failedCallsInput([[failing(), failing()]])])).opportunities;
    expect(rg?.coverage.notAnalysed).toEqual([]);
  });

  it("does not count a canceled call as a failed one (D14)", () => {
    const input = failedCallsInput([[failing(), canceled("rg foo src"), canceled("rg foo src")]]);
    expect(detector.detect(savingsInput([input])).opportunities).toEqual([]);
  });
});

describe("UnusedToolsDetector: subagent calls not analyzed (D7)", () => {
  const linear = [tool("mcp__linear__get_issue", 500), tool("mcp__linear__save_issue", 300)];

  it("notes the subagent calls of the row's sessions without lowering the analyzed count", () => {
    const s = session("s1", { turns: withRounds([4]), toolInventory: linear });
    const audit = buildSessionAudit(auditSession("s1", "2026-10-15T12:00:00Z", [[bySubagent(shell("ls", "success")), bySubagent(shell("pwd", "success"))]]));
    const [opportunity] = new UnusedToolsDetector().detect(savingsInput([{ ...sessionInput(s), audit }])).opportunities;

    expect(opportunity?.coverage).toEqual({
      sessionsInWindow: 1,
      sessionsAnalysed: 1,
      notAnalysed: [{ reason: "2 subagent tool calls not analyzed: this saving reads main-agent calls only.", sessions: 1 }],
    });
  });

  it("adds no note for a session without an audit or subagent calls", () => {
    const s = session("s1", { turns: withRounds([4]), toolInventory: linear });
    const [opportunity] = new UnusedToolsDetector().detect(savingsInput([sessionInput(s)])).opportunities;
    expect(opportunity?.coverage.notAnalysed).toEqual([]);
  });
});
