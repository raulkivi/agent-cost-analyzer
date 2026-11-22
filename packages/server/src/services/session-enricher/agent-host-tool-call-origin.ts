// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { subagentLabelSchema, subagentRunIdSchema, type SubagentRunGap, type ToolCallOrigin } from "@agent-cost-analyzer/domain";
import type { CopilotEvent } from "../../data-sources/agent-host/copilot-event.js";

// Which agent issued an Agent Host tool call (step 10.20,
// https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/subagent-tool-audit.md §5.3). Pure: walks parentToolCallId up,
// like the builder's roundOf.

// The part of a call draft the walk needs.
export interface OriginDraft {
  id: string;
  name: string;
  agentId: string | null;
  parentToolCallId?: string;
}

// Matches the domain's depth bound; deeper nesting is clamped to it.
export const MAX_ORIGIN_DEPTH = 8;
const SEARCH_TOOL = "search_code_subagent";

type SubagentOrigin = Extract<ToolCallOrigin, { kind: "subagent" }>;

// subagent.started.toolCallId -> agentName. Index over the whole log, as a
// run's calls can fall in a later turn than its start.
export function indexSubagentStarts(events: readonly CopilotEvent[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const event of events) {
    if (event.type !== "subagent.started") continue;
    const { toolCallId, agentName } = event.data;
    if (typeof toolCallId === "string" && toolCallId && typeof agentName === "string" && agentName) {
      names.set(toolCallId, agentName);
    }
  }
  return names;
}

// Ids come from a log: keep them inside the domain's run id pattern.
function runIdOf(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
  return subagentRunIdSchema.safeParse(cleaned).success ? cleaned : "unknown";
}

// task-<agentName> from subagent.started; else the starting tool's own name
// when the label pattern has it; else plain "task". A name the pattern
// rejects is dropped, never passed through.
function labelOf(startingCall: OriginDraft | undefined, agentName: string | undefined): string {
  if (startingCall?.name === SEARCH_TOOL) return SEARCH_TOOL;
  if (agentName !== undefined) {
    const candidate = `task-${agentName}`;
    if (subagentLabelSchema.safeParse(candidate).success) return candidate;
  }
  return "task";
}

export function originOf(
  draft: OriginDraft,
  byId: ReadonlyMap<string, OriginDraft>,
  agentNames: ReadonlyMap<string, string>,
): ToolCallOrigin {
  if (draft.agentId === null) return { kind: "main" };

  // Call ids of the runs from the innermost out.
  const runCallIds: string[] = [];
  const seen = new Set<string>([draft.id]);
  let current = draft;
  let reachedCall = true;
  while (current.agentId !== null) {
    const startingId = current.parentToolCallId;
    const next = startingId !== undefined ? byId.get(startingId) : undefined;
    if (startingId === undefined || next === undefined || seen.has(startingId)) {
      reachedCall = false;
      break;
    }
    seen.add(startingId);
    runCallIds.push(startingId);
    current = next;
  }

  if (!reachedCall) {
    // Broken chain or cycle: the run is kept, flagged by the missing
    // startedByCallId, so its totals stay visible (§5.3, §6).
    const startingId = draft.parentToolCallId;
    return {
      kind: "subagent",
      runId: runIdOf(startingId ?? draft.agentId),
      label: labelOf(startingId ? byId.get(startingId) : undefined, startingId ? agentNames.get(startingId) : undefined),
      depth: 1,
    };
  }

  const innermost = runCallIds[0]!;
  const parent = runCallIds[1];
  const origin: SubagentOrigin = {
    kind: "subagent",
    runId: runIdOf(innermost),
    label: labelOf(byId.get(innermost), agentNames.get(innermost)),
    depth: Math.min(runCallIds.length, MAX_ORIGIN_DEPTH),
    ...(parent !== undefined ? { parentRunId: runIdOf(parent) } : {}),
    ...(/^[A-Za-z0-9_.:-]{1,128}$/.test(innermost) ? { startedByCallId: innermost } : {}),
  };
  return origin;
}

// D2: main-agent calls first in source order, then each run's calls in run
// start order (a run starts at its first call), grouped per run.
export function orderByOrigin<T extends { origin?: { kind: string; runId?: string } | undefined }>(items: T[]): T[] {
  const main: T[] = [];
  const runs = new Map<string, T[]>();
  for (const item of items) {
    const runId = item.origin?.kind === "subagent" ? (item.origin.runId ?? "") : undefined;
    if (runId === undefined) {
      main.push(item);
      continue;
    }
    const group = runs.get(runId);
    if (group) group.push(item);
    else runs.set(runId, [item]);
  }
  return [...main, ...[...runs.values()].flat()];
}

export const BROKEN_CHAIN_REASON = "the call that started this subagent run is not in the log";

// One gap per run whose chain never reached a call (plan 5.3, 6, D12): the
// origin has no startedByCallId. The audit builder keeps the run's totals
// and flags it with this reason.
export function brokenChainGaps(origins: readonly (ToolCallOrigin | undefined)[]): SubagentRunGap[] {
  const gaps = new Map<string, SubagentRunGap>();
  for (const origin of origins) {
    if (origin?.kind !== "subagent" || origin.startedByCallId !== undefined || gaps.has(origin.runId)) continue;
    gaps.set(origin.runId, { runId: origin.runId, label: origin.label, depth: 1, reason: BROKEN_CHAIN_REASON });
  }
  return [...gaps.values()];
}
