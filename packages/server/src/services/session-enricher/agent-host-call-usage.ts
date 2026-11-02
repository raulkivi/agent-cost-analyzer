import type { CopilotEvent } from "../../data-sources/agent-host/copilot-event.js";

// Token counts for one model call, from a session.usage_record event
// (vscode-extension.md step 10.15). inputTokens includes cache reads and
// writes; outputTokens includes reasoning.
export interface CopilotCallUsage {
  apiCallId: string | null;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
}

// Null when the event isn't a usable record, so the caller reports the figure
// as unknown instead of as zero.
export function readCopilotCallUsage(event: CopilotEvent): CopilotCallUsage | null {
  if (event.type !== "session.usage_record") return null;
  const usage = isRecord(event.data) ? event.data.usage : undefined;
  if (!isRecord(usage)) return null;

  const inputTokens = count(usage.inputTokens);
  const cacheReadTokens = count(usage.cacheReadTokens);
  const outputTokens = count(usage.outputTokens);
  if (inputTokens === null || cacheReadTokens === null || outputTokens === null) return null;

  return {
    apiCallId: typeof usage.apiCallId === "string" && usage.apiCallId !== "" ? usage.apiCallId : null,
    inputTokens,
    cacheReadTokens,
    outputTokens,
    // The CLI sets cacheDetailsReported to false when its cache-write count isn't reliable.
    cacheWriteTokens: usage.cacheDetailsReported === false ? null : count(usage.cacheWriteTokens),
    reasoningTokens: count(usage.reasoningTokens),
  };
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
