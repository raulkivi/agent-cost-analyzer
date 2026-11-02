// One line of the Copilot CLI's events.jsonl, normalized by the reader so
// the pure builders never see malformed shapes (architecture.md §6.2.2.2).
export interface CopilotEvent {
  id: string;
  type: string;
  parentId: string | null;
  timestamp: string | null;
  // Set on events a subagent emitted, not the main conversation.
  agentId: string | null;
  data: Record<string, unknown>;
}

export interface CopilotEventLog {
  events: CopilotEvent[];
  skippedLines: number;
}
