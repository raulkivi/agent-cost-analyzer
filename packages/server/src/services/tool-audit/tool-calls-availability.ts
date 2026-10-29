import type { Session, Turn } from "@agent-cost-analyzer/domain";

// Only for an Agent Host session without an event-log marker, i.e. one whose
// log was never opened (a list summary); a read session carries its own reason.
export const AGENT_HOST_TOOL_CALLS_UNAVAILABLE_REASON =
  "The tool calls of this VS Code Agent Host session aren't read yet (its Copilot CLI event log wasn't opened), so they are unknown, not zero.";
export const AGENT_HOST_TEXT_UNAVAILABLE_REASON =
  "The prompt and response text of this VS Code Agent Host session isn't read yet (its Copilot CLI event log wasn't opened), so this turn's text is unknown, not empty.";

// Agent Host sessions get their text and tool calls from the Copilot CLI
// event log (step 10.14), so only a read log makes them known.
function eventLogUnavailableReason(session: Session, notReadReason: string): string | undefined {
  if (session.copilotHarness !== "agent-host") {
    return undefined;
  }
  const log = session.copilotEventLog;
  if (log?.status === "read") {
    return undefined;
  }
  return log?.reason ?? notReadReason;
}

// Why the session's tool calls can't be listed, or undefined when they are
// recorded (an empty list then means no calls). Some turns of a known session
// can still be unknown: see turnToolCallsUnavailableReason.
export function toolCallsUnavailableReason(session: Session): string | undefined {
  return eventLogUnavailableReason(session, AGENT_HOST_TOOL_CALLS_UNAVAILABLE_REASON);
}

export function textUnavailableReason(session: Session): string | undefined {
  return eventLogUnavailableReason(session, AGENT_HOST_TEXT_UNAVAILABLE_REASON);
}

// A turn the provider couldn't read (an Agent Host turn the event log can't
// be matched to) is unknown even when the rest of its session is known.
export function turnToolCallsUnavailableReason(session: Session, turn: Turn): string | undefined {
  return turn.toolCallsUnavailableReason ?? toolCallsUnavailableReason(session);
}

export function turnTextUnavailableReason(session: Session, turn: Turn): string | undefined {
  return turn.textUnavailableReason ?? textUnavailableReason(session);
}
