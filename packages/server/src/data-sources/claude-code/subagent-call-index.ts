// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { subagentRunIdSchema } from "@agent-cost-analyzer/domain";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";

// The tool that starts a subagent run. Versions seen name it `Agent`; `Task`
// is accepted for older ones (plan section 9). Runs are linked by
// `meta.toolUseId`, so the name only decides which calls can be missing a run.
const RUN_TOOLS: ReadonlySet<string> = new Set(["Agent", "Task"]);

export interface AgentCall {
  callId: string;
  /** The call's result said `is_error: true`: the launch failed (D8). */
  failed: boolean;
  /** `toolUseResult.agentId` of the call's result: a second link to the run. */
  agentId?: string;
}

function blocksOf(entry: ClaudeCodeRawEntry): Record<string, unknown>[] {
  const content = (entry.message as { content?: unknown } | undefined)?.content;
  return Array.isArray(content)
    ? content.filter((block): block is Record<string, unknown> => typeof block === "object" && block !== null)
    : [];
}

/** Ids of the run-starting calls in `entries`, in order. */
export function agentCallIdsOf(entries: readonly ClaudeCodeRawEntry[]): string[] {
  const ids: string[] = [];
  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    for (const block of blocksOf(entry)) {
      if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string" && RUN_TOOLS.has(block.name)) {
        ids.push(block.id);
      }
    }
  }
  return ids;
}

/** Each run-starting call in `entries` with what its result says. */
export function agentCallsIn(entries: readonly ClaudeCodeRawEntry[]): Map<string, AgentCall> {
  const calls = new Map<string, AgentCall>(agentCallIdsOf(entries).map((callId) => [callId, { callId, failed: false }]));

  for (const entry of entries) {
    if (entry.type !== "user") continue;
    const results = blocksOf(entry).filter((block) => block.type === "tool_result");
    // One `toolUseResult` per line: with several results in a line it names none of them.
    const agentId = (entry.toolUseResult as { agentId?: unknown } | undefined)?.agentId;
    const linkedAgentId = results.length === 1 && subagentRunIdSchema.safeParse(agentId).success ? (agentId as string) : undefined;
    for (const block of results) {
      const call = typeof block.tool_use_id === "string" ? calls.get(block.tool_use_id) : undefined;
      if (call === undefined) continue;
      if (block.is_error === true) call.failed = true;
      if (linkedAgentId !== undefined) call.agentId = linkedAgentId;
    }
  }
  return calls;
}
