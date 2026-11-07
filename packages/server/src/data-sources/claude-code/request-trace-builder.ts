import type { RequestTrace, TraceRequest, UntracedTurn } from "@agent-cost-analyzer/domain";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { groupTurnEntriesByRound, type ClaudeCodeRound } from "./round-grouper.js";
import type { ClaudeCodeTurnGroup } from "./turn-grouper.js";

// Phase 14 step 14.2 (docs/plans/analyze-session-replay.md §4.1, §5): a
// Claude Code session as one record per LLM request, numbers only. Rounds
// are the provider's own (one per message.id, round-grouper.ts) inside its
// own turns (turn-grouper.ts), so a record's turnIndex is the session's.

export const PROVIDER_ID = "claude-code";
export const NO_USAGE_REASON =
  "A request in this turn has no complete usage figures (input, cache read, cache write, output) or no valid time in Claude Code's log.";
export const NO_REQUEST_REASON = "This turn made no LLM request.";

function messageOf(entry: ClaudeCodeRawEntry): Record<string, unknown> | null {
  return typeof entry.message === "object" && entry.message !== null ? (entry.message as Record<string, unknown>) : null;
}

const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;

// The usage object is repeated on every content-block line of one response
// (usage-extractor.ts), so the first line that has it speaks for the round.
function firstOf<T>(round: ClaudeCodeRound, read: (message: Record<string, unknown>) => T | undefined): T | undefined {
  for (const entry of round.entries) {
    const message = messageOf(entry);
    const value = message ? read(message) : undefined;
    if (value !== undefined) return value;
  }
  return undefined;
}

type RequestFigures = Omit<TraceRequest, "index" | "turnIndex" | "event">;

function figuresOf(round: ClaudeCodeRound): RequestFigures | undefined {
  const usage = firstOf(round, (message) => (typeof message.usage === "object" && message.usage !== null ? (message.usage as Record<string, unknown>) : undefined));
  const model = firstOf(round, (message) => (typeof message.model === "string" && message.model.length > 0 ? message.model : undefined));
  const time = round.entries.map((entry) => entry.timestamp).find((value): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value)));
  if (!usage || !model || !time) return undefined;
  const uncachedInput = count(usage.input_tokens);
  const cacheRead = count(usage.cache_read_input_tokens);
  const cacheWrite = count(usage.cache_creation_input_tokens);
  const output = count(usage.output_tokens);
  if (uncachedInput === undefined || cacheRead === undefined || cacheWrite === undefined || output === undefined) return undefined;
  const breakdown = typeof usage.cache_creation === "object" && usage.cache_creation !== null ? (usage.cache_creation as Record<string, unknown>) : undefined;
  const oneHour = count(breakdown?.ephemeral_1h_input_tokens);
  const details = typeof usage.output_tokens_details === "object" && usage.output_tokens_details !== null ? (usage.output_tokens_details as Record<string, unknown>) : undefined;
  const reasoning = count(details?.thinking_tokens);
  return {
    startedAt: new Date(time).toISOString(),
    model,
    uncachedInput,
    cacheRead,
    cacheWrite,
    // Never more than all writes: the schema's rule, and the log's own sum.
    ...(oneHour !== undefined ? { extendedCacheWrite: Math.min(oneHour, cacheWrite) } : {}),
    output,
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
}

// A turn is traced whole or not at all: a request with missing figures
// would break the chain the replay reads deltas from, and an unknown is
// never a 0 (constraint 6). A model change on the main chain is recorded
// as a model-switch event on the first request with the new model.
export function buildClaudeCodeRequestTrace(sessionId: string, groups: ClaudeCodeTurnGroup[]): RequestTrace {
  const requests: TraceRequest[] = [];
  const notTraced: UntracedTurn[] = [];
  groups.forEach((group, turnIndex) => {
    const rounds = groupTurnEntriesByRound(group.entries);
    if (rounds.length === 0) {
      notTraced.push({ turnIndex, reason: NO_REQUEST_REASON });
      return;
    }
    const figures = rounds.map(figuresOf);
    if (figures.some((value) => value === undefined)) {
      notTraced.push({ turnIndex, reason: NO_USAGE_REASON });
      return;
    }
    for (const value of figures as RequestFigures[]) {
      const previous = requests.at(-1);
      // Times are kept in order: a line written out of order never makes a
      // gap go negative.
      const startedAt = previous && value.startedAt < previous.startedAt ? previous.startedAt : value.startedAt;
      const switched = previous !== undefined && previous.model !== value.model;
      requests.push({ index: requests.length, turnIndex, ...value, startedAt, ...(switched ? { event: "model-switch" as const } : {}) });
    }
  });
  return { sessionId, providerId: PROVIDER_ID, harness: "claude-code", requests, notTraced };
}
