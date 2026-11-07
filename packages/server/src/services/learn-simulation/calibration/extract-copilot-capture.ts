// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Harness } from "@agent-cost-analyzer/domain";
import type { CopilotEvent } from "../../../data-sources/agent-host/copilot-event.js";
import { readCopilotCallUsage } from "../../session-enricher/agent-host-call-usage.js";
import type { CalibrationCapture, CaptureRequest } from "./capture.js";

// One LLM request as either Copilot store records it, before reduction.
export interface CopilotRequestUsage {
  startedAtMs: number;
  model: string;
  // Total input, cache reads and writes included (Copilot's own convention).
  inputTokens: number;
  cacheReadTokens: number;
  // null when the store doesn't record cache writes (the local harness
  // without agent-traces.db, or an Agent Host record with unreliable details).
  cacheWriteTokens: number | null;
  outputTokens: number;
}

export interface CopilotCaptureOptions {
  id: string;
  source: Extract<
    CalibrationCapture["source"],
    "copilot-agent-host" | "copilot-local"
  >;
  harness: Harness;
  modelId: string;
  // Keep only requests whose model starts with this (drops Copilot's own
  // title-generation calls to a small model).
  modelPrefix?: string;
  // Keep the first N requests, to bound a capture.
  limit?: number;
}

const MS_PER_MINUTE = 60_000;
const WRITES_UNKNOWN_NOTE =
  "Cache writes are not recorded by this store: uncachedInput holds everything that was not read from cache (plain input and cache writes together), and cacheWrite is 0. Compare cache reads and hit or miss only.";

// Reduces Copilot's per-request usage to the numbers a calibration replay
// needs. Nothing but sizes and gaps survives: no text, titles, paths or ids.
export function captureFromCopilotRequests(
  requests: CopilotRequestUsage[],
  options: CopilotCaptureOptions,
): CalibrationCapture {
  const prefix = options.modelPrefix;
  const kept = requests
    .filter(
      (request) => prefix === undefined || request.model.startsWith(prefix),
    )
    .sort((a, b) => a.startedAtMs - b.startedAtMs)
    .slice(0, options.limit);

  let writesUnknown = false;
  const reduced: CaptureRequest[] = kept.map((request, index) => {
    if (request.cacheReadTokens > request.inputTokens) {
      throw new Error(
        `Request ${index}: cache read (${request.cacheReadTokens}) exceeds its input (${request.inputTokens})`,
      );
    }
    const written = request.cacheWriteTokens;
    if (written === null) writesUnknown = true;
    const cacheWrite = written ?? 0;
    const previous = kept[index - 1];
    return {
      index,
      gapMinutes:
        previous === undefined
          ? 0
          : roundGap(
              (request.startedAtMs - previous.startedAtMs) / MS_PER_MINUTE,
            ),
      recorded: {
        uncachedInput: Math.max(
          request.inputTokens - request.cacheReadTokens - cacheWrite,
          0,
        ),
        cacheRead: request.cacheReadTokens,
        cacheWrite,
        output: request.outputTokens,
      },
    };
  });

  return {
    id: options.id,
    source: options.source,
    harness: options.harness,
    vendorId: "anthropic",
    modelId: options.modelId,
    ...(writesUnknown ? { notes: WRITES_UNKNOWN_NOTE } : {}),
    requests: reduced,
  };
}

// Agent Host: one session.usage_record per model call in the Copilot CLI
// event log. Sub-agent calls carry their own prompt and are left out.
export function captureFromAgentHostEvents(
  events: CopilotEvent[],
  options: CopilotCaptureOptions,
): CalibrationCapture {
  const requests: CopilotRequestUsage[] = [];
  for (const event of events) {
    if (event.agentId !== null) continue;
    const usage = readCopilotCallUsage(event);
    const model = (event.data.usage as { model?: unknown } | undefined)?.model;
    const startedAt =
      event.timestamp === null ? Number.NaN : Date.parse(event.timestamp);
    if (usage === null || typeof model !== "string" || Number.isNaN(startedAt))
      continue;
    requests.push({
      startedAtMs: startedAt,
      model,
      inputTokens: usage.inputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      outputTokens: usage.outputTokens,
    });
  }
  return captureFromCopilotRequests(requests, options);
}

const roundGap = (minutes: number): number => Math.round(minutes * 1000) / 1000;
