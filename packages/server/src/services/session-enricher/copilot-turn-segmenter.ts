import type { CopilotEvent } from "../../data-sources/agent-host/copilot-event.js";

// Splits a Copilot CLI event log into the turns session.db recorded
// (vscode-extension.md step 10.14, architecture.md §6.2.2.2). Pure: the
// builders for turn text, inspector rounds and the system prompt consume
// its output, so none of them re-derive turn boundaries.

// The part of a session.db turn row the segmenter needs. Structural so it
// doesn't depend on the store module.
export interface SegmenterTurn {
  turnId: string;
  eventId: string | null;
}

export interface MatchedTurn {
  turnId: string;
  matched: true;
  // The user.message that opened the turn.
  userMessage: CopilotEvent;
  // Everything after userMessage up to the next matched turn's user.message,
  // in file order. Subagent events stay here (see isSubagentEvent) because
  // their tool calls belong to the turn, but their text and rounds don't.
  events: CopilotEvent[];
}

export interface UnmatchedTurn {
  turnId: string;
  matched: false;
  // Shown to the user, because unknown must never read as empty (constraint 6).
  reason: string;
}

export type SegmentedTurn = MatchedTurn | UnmatchedTurn;

export interface SegmentedCopilotLog {
  // Same order as the input turns.
  turns: SegmentedTurn[];
  // Events before the first matched turn (session.start, the first system.message).
  sessionEvents: CopilotEvent[];
}

export const TURN_NO_EVENT_ID_REASON =
  "The Copilot CLI event log can't be matched to this turn: it has no event id.";
export const TURN_EVENT_NOT_FOUND_REASON =
  "The Copilot CLI event log has no user message for this turn.";
export const TURN_EVENT_ALREADY_TAKEN_REASON =
  "An earlier turn already matched this turn's user message, so this turn is a duplicate record.";

// A subagent's events carry a top-level agentId; the main conversation's don't.
export function isSubagentEvent(event: CopilotEvent): boolean {
  return event.agentId !== null;
}

// Subagent prompts are also user.message events, but they aren't something
// the user typed, so they never open a turn.
function isTurnBoundary(event: CopilotEvent): boolean {
  if (event.type !== "user.message" || isSubagentEvent(event)) return false;
  const source = event.data.source;
  return !(typeof source === "string" && source.startsWith("agent-"));
}

// session.db stores a request_<uuid> id, which the log never contains. The
// event id is the real key; an aborted turn's second record has none and
// carries the event id as its bare turn id instead.
function resolveEventId(turn: SegmenterTurn): string | null {
  if (turn.eventId) return turn.eventId;
  return turn.turnId.startsWith("request_") ? null : turn.turnId || null;
}

export function segmentCopilotTurns(events: CopilotEvent[], turns: SegmenterTurn[]): SegmentedCopilotLog {
  const indexById = new Map<string, number>();
  events.forEach((event, index) => {
    if (isTurnBoundary(event) && !indexById.has(event.id)) indexById.set(event.id, index);
  });

  const taken = new Set<number>();
  const resolved: ({ index: number } | { reason: string })[] = turns.map((turn) => {
    const eventId = resolveEventId(turn);
    if (eventId === null) return { reason: TURN_NO_EVENT_ID_REASON };
    const index = indexById.get(eventId);
    if (index === undefined) return { reason: TURN_EVENT_NOT_FOUND_REASON };
    // The first turn row wins; a later duplicate has the same events.
    if (taken.has(index)) return { reason: TURN_EVENT_ALREADY_TAKEN_REASON };
    taken.add(index);
    return { index };
  });

  // Cut by file position, not row order, so a turn ends where the next
  // matched user.message starts.
  const boundaries = [...taken].sort((a, b) => a - b);
  const endOf = (index: number): number => boundaries[boundaries.indexOf(index) + 1] ?? events.length;

  return {
    sessionEvents: events.slice(0, boundaries[0] ?? events.length),
    turns: turns.map((turn, i): SegmentedTurn => {
      const r = resolved[i]!;
      if ("reason" in r) return { turnId: turn.turnId, matched: false, reason: r.reason };
      return {
        turnId: turn.turnId,
        matched: true,
        userMessage: events[r.index]!,
        events: events.slice(r.index + 1, endOf(r.index)),
      };
    }),
  };
}
