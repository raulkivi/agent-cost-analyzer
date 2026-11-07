// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { TurnView } from "@agent-cost-analyzer/domain";

// An invented get_turn result for the turn-detail tests.
export function turnView(overrides: Partial<TurnView> = {}): TurnView {
  const known = (value: number, estimated?: boolean) => ({ known: true as const, value, ...(estimated === undefined ? {} : { estimated }) });
  const unknown = { known: false as const, reason: "no data" };
  return {
    sessionId: "7f3a9c2e",
    turnIndex: 17,
    turnCount: 42,
    model: "claude-sonnet-5.5",
    triggeredEvent: "compaction",
    userMessage: "Rewrite the decoder to stream frames instead of buffering the whole payload.",
    userMessageTruncated: false,
    assistantResponse: "Done. The decoder now yields frames.",
    assistantResponseTruncated: false,
    explanation: "Context was compacted before this turn.",
    usage: {
      uncachedInput: known(19_806),
      cacheWrite: known(22_516),
      cacheRead: known(268_090),
      tool: unknown,
      vision: unknown,
      reasoning: unknown,
      output: known(3108, true),
      costAiCredits: known(4.1),
      model: "claude-sonnet-5.5",
    },
    cost: { billed: unknown, reported: unknown, priced: unknown },
    preferredCost: unknown,
    toolCalls: [
      { name: "read_file", kind: "file-read", status: "success" },
      { name: "read_file", kind: "file-read", status: "success" },
      { name: "run_tests", kind: "shell", status: "error" },
    ],
    ...overrides,
  } as TurnView;
}
