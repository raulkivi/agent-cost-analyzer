import type { Session } from "@agent-cost-analyzer/domain";

export const AGENT_HOST_TOOL_CALLS_UNAVAILABLE_REASON =
  "Tool calls of VS Code Agent Host sessions aren't read yet, so this session's tool calls are unknown, not zero.";
export const AGENT_HOST_TEXT_UNAVAILABLE_REASON =
  "The prompt and response text of VS Code Agent Host sessions isn't read yet, so this turn's text is unknown, not empty.";

// Why the session's tool calls can't be listed, or undefined when they are
// recorded (an empty list then means no calls).
export function toolCallsUnavailableReason(session: Session): string | undefined {
  return session.copilotHarness === "agent-host" ? AGENT_HOST_TOOL_CALLS_UNAVAILABLE_REASON : undefined;
}

export function textUnavailableReason(session: Session): string | undefined {
  return session.copilotHarness === "agent-host" ? AGENT_HOST_TEXT_UNAVAILABLE_REASON : undefined;
}
