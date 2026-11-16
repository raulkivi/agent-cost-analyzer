// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { subagentRunGapSchema, unavailableTokenCount, type Session, type Turn } from "@agent-cost-analyzer/domain";
import type { CopilotEvent } from "../../data-sources/agent-host/copilot-event.js";
import { buildSessionAudit } from "../tool-audit/session-audit-builder.js";
import { BROKEN_CHAIN_REASON } from "./agent-host-tool-call-origin.js";
import { buildAgentHostTurnContent } from "./agent-host-turn-content-builder.js";
import type { MatchedTurn } from "./copilot-turn-segmenter.js";

let n = 0;
const event = (type: string, data: Record<string, unknown>, agentId: string | null = null): CopilotEvent => ({
  id: `e${n++}`,
  type,
  parentId: null,
  timestamp: "2026-10-21T10:00:00.000Z",
  agentId,
  data,
});

function turnOf(events: CopilotEvent[]): MatchedTurn {
  return { turnId: "t", matched: true, userMessage: event("user.message", { content: "hi" }), events };
}

const call = (id: string, name: string, agentId: string | null, parent?: string): CopilotEvent[] => [
  event("tool.execution_start", { toolCallId: id, toolName: name, arguments: {}, ...(parent ? { parentToolCallId: parent } : {}) }, agentId),
  event("tool.execution_complete", { toolCallId: id, success: true }, agentId),
];

const known = (value: number) => ({ known: true as const, value });

describe("subagentRunGaps from a broken chain", () => {
  const broken = buildAgentHostTurnContent(
    turnOf([...call("m1", "view", null), ...call("U1", "view", "agent-1", "gone"), ...call("U2", "grep", "agent-1", "gone")]),
  );

  it("adds one gap per run whose starting call is not in the log", () => {
    expect(broken.subagentRunGaps).toEqual([{ runId: "gone", label: "task", depth: 1, reason: BROKEN_CHAIN_REASON }]);
    expect(subagentRunGapSchema.safeParse(broken.subagentRunGaps![0]).success).toBe(true);
    expect(BROKEN_CHAIN_REASON).toBe("the call that started this subagent run is not in the log");
  });

  it("adds no gap when every chain reaches a main call", () => {
    const ok = buildAgentHostTurnContent(turnOf([...call("T1", "task", null), ...call("U1", "view", "agent-1", "T1")]));
    expect(ok.subagentRunGaps).toBeUndefined();
  });

  it("shows the run in the session audit with known totals and the reason", () => {
    const turn: Turn = {
      index: 0,
      userMessage: "",
      assistantResponse: "",
      toolCalls: broken.toolCalls,
      ...(broken.subagentRunGaps ? { subagentRunGaps: broken.subagentRunGaps } : {}),
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
      explanation: "",
    };
    const session = { id: "s", mode: "analyze", providerId: "copilot", title: "t", model: "m", turns: [turn] } as unknown as Session;
    const run = buildSessionAudit(session).subagentRuns?.find((r) => r.runId === "gone");
    expect(run?.totals).not.toBeNull();
    expect(run?.totals?.toolCalls).toBe(2);
    expect(run?.unreadReason).toBe(BROKEN_CHAIN_REASON);
  });
});
