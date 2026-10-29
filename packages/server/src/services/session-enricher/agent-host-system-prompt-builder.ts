import type { SystemPromptComponent, TokenCount } from "@agent-cost-analyzer/domain";
import { unavailableTokenCount } from "@agent-cost-analyzer/domain";
import type { CopilotEvent } from "../../data-sources/agent-host/copilot-event.js";
import { estimateTokenCount } from "../../data-sources/jsonl/token-estimator.js";
import type { SystemPromptTextLookup } from "../../data-sources/log-providers/system-prompt-text-reader.js";

// System prompt of a VS Code Agent Host session, from the Copilot CLI event
// log (vscode-extension.md step 10.14, architecture.md §6.2.2.2). Pure: the
// event-log reader does the I/O.

export const AGENT_HOST_TOOL_DEFINITIONS_UNAVAILABLE_REASON =
  "The Copilot CLI event log records no tool-definition token count for this system prompt (no session.shutdown or session.compaction_start followed it).";

export interface AgentHostSystemPrompt {
  text: string;
  components: SystemPromptComponent[];
}

// session.shutdown and session.compaction_start both carry real counts.
const TOKEN_SNAPSHOT_TYPES = new Set(["session.shutdown", "session.compaction_start"]);

function isMainSystemMessage(event: CopilotEvent): boolean {
  return event.type === "system.message" && event.agentId === null && typeof event.data.content === "string" && event.data.content !== "";
}

function validCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

// The last real value of `field` among the snapshots after the prompt: counts
// recorded before a re-emitted prompt describe the older prompt.
function lastSnapshotCount(snapshots: CopilotEvent[], field: string): number | null {
  for (let i = snapshots.length - 1; i >= 0; i -= 1) {
    const value = validCount(snapshots[i].data[field]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function realOr(value: number | null, fallback: () => TokenCount): TokenCount {
  return value !== null ? { known: true, value } : fallback();
}

export function buildAgentHostSystemPrompt(events: CopilotEvent[]): AgentHostSystemPrompt | null {
  const promptIndex = events.findLastIndex(isMainSystemMessage);
  if (promptIndex < 0) {
    return null;
  }

  const text = events[promptIndex].data.content as string;
  const snapshots = events.slice(promptIndex + 1).filter((event) => TOKEN_SNAPSHOT_TYPES.has(event.type));

  return {
    text,
    components: [
      {
        kind: "built-in",
        label: `Base system prompt (${text.length.toLocaleString()} characters)`,
        tokenCount: realOr(lastSnapshotCount(snapshots, "systemTokens"), () => estimateTokenCount(text)),
      },
      {
        kind: "tool-definitions",
        label: "Tool definitions",
        tokenCount: realOr(lastSnapshotCount(snapshots, "toolDefinitionsTokens"), () =>
          unavailableTokenCount(AGENT_HOST_TOOL_DEFINITIONS_UNAVAILABLE_REASON),
        ),
      },
    ],
  };
}

export function lookupAgentHostSystemPromptText(events: CopilotEvent[]): SystemPromptTextLookup {
  const built = buildAgentHostSystemPrompt(events);
  return built ? { status: "found", text: built.text } : { status: "not-captured" };
}
