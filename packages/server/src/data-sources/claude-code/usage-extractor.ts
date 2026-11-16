// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { unavailableTokenCount } from "@agent-cost-analyzer/domain";
import type { TurnUsage } from "@agent-cost-analyzer/domain";
import { modelOf, sumRoundUsage } from "./round-usage.js";
import { groupTurnRequestRounds } from "./round-grouper.js";
import type { ClaudeCodeTurnGroup } from "./turn-grouper.js";

const NO_AI_CREDITS_REASON =
  "AI Credits are GitHub Copilot's own billing unit — a Claude Code CLI session has no AI Credits conversion.";
// Confirmed real fields (usage.input_tokens/output_tokens/cache_*) cover
// input/output/cache; nothing in the real `usage` shape separates a
// tool-call's or an image's token cost from the rest of input/output —
// ship unavailable rather than guess, per constraint 6.
const NO_TOOL_VISION_SEPARATION_REASON =
  "Claude Code's usage object has no field that separates tool-call or vision token cost from input/output.";

// Per-turn usage summed once per round (round-grouper.ts's grouping-by-
// message.id, not per raw JSONL entry) — a turn can span several
// round-trips when the agent loops through tool calls before answering,
// same "sum every round in the turn" pattern as pi-agent/usage-extractor.ts
// and the VS Code provider's session-usage-spans.ts. Synthetic rounds (the
// CLI's own "<synthetic>" lines, round-grouper.ts) are no request, so they
// are neither counted nor taken as the turn's model.
export function extractTurnUsage(group: ClaudeCodeTurnGroup): TurnUsage {
  const rounds = groupTurnRequestRounds(group.entries);
  const model = rounds.length > 0 ? modelOf(rounds[rounds.length - 1]) ?? "unknown" : "unknown";

  const sums = sumRoundUsage(rounds);

  return {
    uncachedInput: sums.uncachedInput,
    cacheWrite: sums.cacheWrite,
    cacheRead: sums.cacheRead,
    tool: unavailableTokenCount(NO_TOOL_VISION_SEPARATION_REASON),
    vision: unavailableTokenCount(NO_TOOL_VISION_SEPARATION_REASON),
    reasoning: sums.reasoning,
    output: sums.output,
    costAiCredits: unavailableTokenCount(NO_AI_CREDITS_REASON),
    model,
    roundsCount: rounds.length,
    extendedCacheWrite: sums.extendedCacheWrite,
  };
}
