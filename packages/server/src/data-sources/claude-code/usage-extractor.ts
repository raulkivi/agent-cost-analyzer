import { sumTokenCounts, unavailableTokenCount, type TokenCount } from "@agent-cost-analyzer/domain";
import type { TurnUsage } from "@agent-cost-analyzer/domain";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { groupTurnEntriesByRound, type ClaudeCodeRound } from "./round-grouper.js";
import type { ClaudeCodeTurnGroup } from "./turn-grouper.js";

const MISSING_FIELD_REASON =
  "Claude Code's assistant message did not include a numeric usage figure for this round.";
const NO_AI_CREDITS_REASON =
  "AI Credits are GitHub Copilot's own billing unit — a Claude Code CLI session has no AI Credits conversion.";
// Confirmed real fields (usage.input_tokens/output_tokens/cache_*) cover
// input/output/cache; nothing in the real `usage` shape separates a
// tool-call's or an image's token cost from the rest of input/output —
// ship unavailable rather than guess, per constraint 6.
const NO_TOOL_VISION_SEPARATION_REASON =
  "Claude Code's usage object has no field that separates tool-call or vision token cost from input/output.";

function messageOf(entry: ClaudeCodeRawEntry): Record<string, unknown> | null {
  return typeof entry.message === "object" && entry.message !== null
    ? (entry.message as Record<string, unknown>)
    : null;
}

// The full `usage` object is repeated identically across every content-block
// entry that shares one message.id (confirmed against a real captured
// session — it describes the whole response, not the individual block), so
// exactly one entry's usage represents the round; summing per-entry would
// multiply-count a response split across several blocks.
function usageOf(round: ClaudeCodeRound): Record<string, unknown> | undefined {
  for (const entry of round.entries) {
    const usage = messageOf(entry)?.usage;
    if (typeof usage === "object" && usage !== null) {
      return usage as Record<string, unknown>;
    }
  }
  return undefined;
}

function modelOf(round: ClaudeCodeRound): string | undefined {
  for (const entry of round.entries) {
    const model = messageOf(entry)?.model;
    if (typeof model === "string") {
      return model;
    }
  }
  return undefined;
}

function numericField(value: unknown): TokenCount {
  return typeof value === "number" ? { known: true, value } : unavailableTokenCount(MISSING_FIELD_REASON);
}

function sumField(rounds: ClaudeCodeRound[], field: string): TokenCount {
  return sumTokenCounts(
    rounds.map((round) => numericField(usageOf(round)?.[field])),
    MISSING_FIELD_REASON,
  );
}

function sumReasoningField(rounds: ClaudeCodeRound[]): TokenCount {
  return sumTokenCounts(
    rounds.map((round) => {
      const details = usageOf(round)?.output_tokens_details;
      const value = typeof details === "object" && details !== null ? (details as Record<string, unknown>).thinking_tokens : undefined;
      return numericField(value);
    }),
    MISSING_FIELD_REASON,
  );
}

const NO_EXTENDED_SPLIT_REASON =
  "Claude Code's usage object for a round that wrote cache did not split its cache writes by lifetime (cache_creation.ephemeral_1h_input_tokens), so how many were 1-hour writes is unknown.";

// Phase 15 step 15.6: the 1-hour subset of each round's cache writes
// (`usage.cache_creation.ephemeral_1h_input_tokens`, seen in real captures
// beside `ephemeral_5m_input_tokens`), which the 1-hour price applies to. A
// round that wrote nothing has none even without the breakdown.
function extendedCacheWriteOf(round: ClaudeCodeRound): TokenCount {
  const usage = usageOf(round);
  const breakdown = usage?.cache_creation;
  if (typeof breakdown === "object" && breakdown !== null) {
    const value = (breakdown as Record<string, unknown>).ephemeral_1h_input_tokens;
    if (typeof value === "number") return { known: true, value };
  }
  return usage?.cache_creation_input_tokens === 0 ? { known: true, value: 0 } : unavailableTokenCount(NO_EXTENDED_SPLIT_REASON);
}

// Per-turn usage summed once per round (round-grouper.ts's grouping-by-
// message.id, not per raw JSONL entry) — a turn can span several
// round-trips when the agent loops through tool calls before answering,
// same "sum every round in the turn" pattern as pi-agent/usage-extractor.ts
// and the VS Code provider's session-usage-spans.ts.
export function extractTurnUsage(group: ClaudeCodeTurnGroup): TurnUsage {
  const rounds = groupTurnEntriesByRound(group.entries);
  const model = rounds.length > 0 ? modelOf(rounds[rounds.length - 1]) ?? "unknown" : "unknown";

  return {
    uncachedInput: sumField(rounds, "input_tokens"),
    cacheWrite: sumField(rounds, "cache_creation_input_tokens"),
    cacheRead: sumField(rounds, "cache_read_input_tokens"),
    tool: unavailableTokenCount(NO_TOOL_VISION_SEPARATION_REASON),
    vision: unavailableTokenCount(NO_TOOL_VISION_SEPARATION_REASON),
    reasoning: sumReasoningField(rounds),
    output: sumField(rounds, "output_tokens"),
    costAiCredits: unavailableTokenCount(NO_AI_CREDITS_REASON),
    model,
    roundsCount: rounds.length,
    extendedCacheWrite: sumTokenCounts(rounds.map(extendedCacheWriteOf), NO_EXTENDED_SPLIT_REASON),
  };
}
