// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import type { ToolCallRecord } from "@agent-cost-analyzer/domain";
import { readClassicSubagentAudit, type ClassicSubagentAudit } from "../data-sources/jsonl/classic-subagent-audit.js";
import { collectChildSessionRefs } from "../data-sources/jsonl/child-session-refs.js";
import { readMainJsonlFile } from "../data-sources/jsonl/main-jsonl-reader.js";
import { attributeSubagentRuns, logTurnStartTimes } from "../data-sources/jsonl/subagent-attribution.js";
import { folderSubagentLogSource } from "../data-sources/jsonl/subagent-log-source.js";
import { readToolCallRecordsByLogTurn } from "../data-sources/jsonl/tool-call-spans.js";

export interface AuditedFolder extends ClassicSubagentAudit {
  mainCallsByLogTurn: ToolCallRecord[][];
  // Runs the attribution found a file for (read or not decided by the audit).
  readRunIds: Set<string>;
}

// The classic audit over one session folder, from its main.jsonl as the
// provider does: attribution first, then the plan and the child reads.
export async function classicSubagentAudit(sessionDir: string): Promise<AuditedFolder> {
  const mainJsonlPath = path.join(sessionDir, "main.jsonl");
  const { envelopes } = await readMainJsonlFile(mainJsonlPath);
  const attribution = await attributeSubagentRuns({
    folderId: path.basename(sessionDir),
    refs: collectChildSessionRefs(envelopes),
    logTurnStarts: logTurnStartTimes(envelopes),
    source: folderSubagentLogSource(sessionDir),
  });
  const mainCallsByLogTurn = await readToolCallRecordsByLogTurn(mainJsonlPath);
  const audit = await readClassicSubagentAudit({ attribution, mainCallsByLogTurn, sessionDir });
  return {
    ...audit,
    mainCallsByLogTurn,
    readRunIds: new Set(attribution.runs.filter((run) => run.log.status === "read").map((run) => run.runId)),
  };
}
