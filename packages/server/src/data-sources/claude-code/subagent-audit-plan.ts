// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SubagentRunUsage } from "@agent-cost-analyzer/domain";
import { auditReasonOfUsageReason, BEYOND_READ_DEPTH_AUDIT_REASON } from "./subagent-audit-reasons.js";
import { MAX_CLAUDE_CODE_RUN_DEPTH, type ClaudeCodeSubagentAttribution } from "./subagent-attribution.js";
import type { SubagentMeta } from "./subagent-meta.js";

// CS14: which runs the audit reads and which it can't, from CS8's attribution.
// Pure: no file is touched here.

const CALL_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export interface AuditRunRef {
  /** The turn whose `Agent` call started the run (the whole run belongs to it, D1). */
  turn: number;
  runId: string;
  label: string;
  /** 1 = started by the main agent. */
  depth: number;
  parentRunId?: string;
  /** The call that started the run, when its meta names one. */
  startedByCallId?: string;
  /** CS8 placed the run by time, not by a link (attribution `timestamp`). */
  matchedByTime?: true;
}

export interface UnreadAuditRun extends AuditRunRef {
  reason: string;
}

export interface ClaudeCodeAuditPlan {
  /** Runs whose transcript the audit reads, in turn order then start order. */
  reads: AuditRunRef[];
  unread: UnreadAuditRun[];
}

interface Placed {
  turn: number;
  usage: SubagentRunUsage;
}

// The depth the parent chain gives, or the meta's own spawnDepth when larger;
// a chain through an unknown parent stops there, a cycle never ends.
function depthOf(run: SubagentRunUsage, byId: ReadonlyMap<string, Placed>, spawnDepth: number | undefined): number {
  const seen = new Set<string>([run.id]);
  let depth = 1;
  let parentId = run.parentRunId;
  while (parentId !== undefined && byId.has(parentId)) {
    if (seen.has(parentId)) return Number.POSITIVE_INFINITY;
    seen.add(parentId);
    depth += 1;
    parentId = byId.get(parentId)!.usage.parentRunId;
  }
  return Math.max(depth, spawnDepth ?? 1);
}

export function planClaudeCodeAudit(
  attribution: Pick<ClaudeCodeSubagentAttribution, "byTurn">,
  metas: ReadonlyMap<string, SubagentMeta>,
): ClaudeCodeAuditPlan {
  const placed: Placed[] = [...attribution.byTurn.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([turn, { runs }]) => runs.map((usage) => ({ turn, usage })));
  const byId = new Map(placed.map((entry) => [entry.usage.id, entry]));

  const reads: AuditRunRef[] = [];
  const unread: UnreadAuditRun[] = [];
  for (const { turn, usage } of placed) {
    const meta = metas.get(usage.id);
    const depth = depthOf(usage, byId, meta?.spawnDepth);
    const tooDeep = depth > MAX_CLAUDE_CODE_RUN_DEPTH;
    const ref: AuditRunRef = {
      turn,
      runId: usage.id,
      label: usage.label,
      depth: tooDeep ? MAX_CLAUDE_CODE_RUN_DEPTH : depth,
      ...(depth > 1 && usage.parentRunId !== undefined ? { parentRunId: usage.parentRunId } : {}),
      ...(meta?.toolUseId !== undefined && CALL_ID.test(meta.toolUseId) ? { startedByCallId: meta.toolUseId } : {}),
      ...(usage.attribution === "timestamp" ? { matchedByTime: true as const } : {}),
    };

    const reason = tooDeep
      ? BEYOND_READ_DEPTH_AUDIT_REASON
      : usage.output.known
        ? undefined
        : auditReasonOfUsageReason(usage.output.reason, usage.label);
    if (reason === undefined) reads.push(ref);
    else unread.push({ ...ref, reason });
  }
  return { reads, unread };
}
