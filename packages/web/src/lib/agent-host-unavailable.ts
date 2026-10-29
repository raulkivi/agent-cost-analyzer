import type { Session } from "@agent-cost-analyzer/domain";

// What the UI says where a VS Code Agent Host session lacks data the Copilot
// CLI event log would hold (step 10.14). The reasons themselves come from the
// server (Session.copilotEventLog, Turn.*UnavailableReason, ...).

// The session-level reason its event log wasn't read; undefined when it was
// read or the session carries no marker (other providers).
export function eventLogUnavailableReason(
  session: Pick<Session, "copilotEventLog"> | null | undefined,
): string | undefined {
  const log = session?.copilotEventLog;
  return log && log.status !== "read" ? log.reason : undefined;
}

export const AGENT_HOST_TOOL_INVENTORY_UNAVAILABLE =
  "The Copilot CLI event log records no tool definitions, so the tool inventory of Agent Host sessions is unknown.";

export const TURN_INSPECTOR_UNAVAILABLE_TITLE = "Not available";

export const AUDIT_UNAVAILABLE_TITLE = "Tool calls not available";
export const AUDIT_UNAVAILABLE_NOTE = "That doesn't mean the agent ran no tools.";

// Sessions whose tool calls are unknown are left out of the cross-session
// audit's counts and rates, never counted as 0 calls.
export function agentHostRollupNotIncluded(count: number): string {
  return `${count} Agent Host ${count === 1 ? "session" : "sessions"} not included: no Copilot CLI event log.`;
}
