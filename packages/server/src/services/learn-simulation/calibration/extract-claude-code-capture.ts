import type { ClaudeCodeRawEntry } from "../../../data-sources/claude-code/claude-code-jsonl-reader.js";
import type { CalibrationCapture, CaptureRequest } from "./capture.js";

interface Usage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens?: number;
  cache_creation?: { ephemeral_1h_input_tokens?: number };
}

const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

// One Claude Code response is written as one JSONL line per content block,
// all sharing a message id and the same usage. Sub-agent (sidechain)
// requests have their own prompt, so they don't belong in a main-chain series.
export function extractClaudeCodeCapture(
  entries: ClaudeCodeRawEntry[],
  meta: { id: string; modelId: string; notes?: string },
): CalibrationCapture {
  const byMessage = new Map<string, { at: number; usage: Usage }>();
  for (const entry of entries) {
    if (entry.type !== "assistant" || entry.isSidechain === true) continue;
    const message = entry.message as
      { id?: unknown; usage?: Usage } | undefined;
    if (typeof message?.id !== "string" || message.usage === undefined)
      continue;
    if (byMessage.has(message.id)) continue;
    const at = Date.parse(String(entry.timestamp));
    if (Number.isNaN(at)) continue;
    byMessage.set(message.id, { at, usage: message.usage });
  }

  const requests: CaptureRequest[] = [];
  let previousAt: number | undefined;
  for (const { at, usage } of byMessage.values()) {
    const written = num(usage.cache_creation_input_tokens);
    const oneHour = Math.min(
      written,
      num(usage.cache_creation?.ephemeral_1h_input_tokens),
    );
    requests.push({
      index: requests.length,
      gapMinutes:
        previousAt === undefined ? 0 : Math.max(0, (at - previousAt) / 60_000),
      recorded: {
        uncachedInput: num(usage.input_tokens),
        cacheRead: num(usage.cache_read_input_tokens),
        cacheWrite: written - oneHour,
        extendedCacheWrite: oneHour,
        output: num(usage.output_tokens),
      },
    });
    previousAt = at;
  }
  return {
    id: meta.id,
    source: "claude-code",
    harness: "claude-code",
    vendorId: "anthropic",
    modelId: meta.modelId,
    ...(meta.notes ? { notes: meta.notes } : {}),
    requests,
  };
}
