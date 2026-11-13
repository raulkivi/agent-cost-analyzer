// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import type { TurnUsage } from "@agent-cost-analyzer/domain";
import { loadAgentTraceUsageForResponseIds } from "../agent-traces/agent-traces-reader.js";
import { alignLogTurnsToStore, logTurnDigests, placeByStoreIndex, storeTurnKeys } from "./log-turn-alignment.js";
import {
  classifyEnvelopesAvailability,
  readMainJsonlFile,
  type JsonlEnvelope,
  type MainJsonlAvailability,
} from "./main-jsonl-reader.js";
import { collectChildSessionRefs } from "./child-session-refs.js";
import { collectResponseIds, extractTurnUsages } from "./session-usage-spans.js";
import { attributeSubagentRuns, logTurnStartTimes, type SubagentAttribution } from "./subagent-attribution.js";
import { folderSubagentLogSource } from "./subagent-log-source.js";
import { mergeSubagentUsage } from "./subagent-usage-merge.js";

export interface ClassicUsageInput {
  // The session's main.jsonl, or null when it has none.
  mainJsonlPath: string | null;
  storeTurns: readonly { turn_index: number; user_message: string | null }[];
  // Only the detail read passes this (null: configured with no db): it joins
  // agent-traces.db for the main agent's and the runs' cacheWrite/reasoning.
  // Undefined, as in the list, joins nothing and opens no second db.
  agentTracesDbPath?: string | null;
}

export interface ClassicUsage {
  availability: MainJsonlAvailability;
  // Per store turn index, the subagent runs folded in.
  turnUsages: (TurnUsage | null)[];
  // Per log turn, its store turn index (null where unplaced).
  alignment: (number | null)[];
  // Present only when main.jsonl has events: the runs read, and why any is unknown.
  attribution?: SubagentAttribution;
  envelopes: JsonlEnvelope[];
}

// One reader for a classic session's usage, so the list (Sessions view,
// status bar, list_sessions) and the detail (turns table, get_session_cost)
// cannot drift (step 10.19, plan §4.2/§4.3). Refs, turn starts and usages all
// come from the same envelopes, so no run is keyed outside `turnUsages`; the
// runs merge per log turn, then one alignment lays everything on store turns.
export async function readClassicUsage({ mainJsonlPath, storeTurns, agentTracesDbPath }: ClassicUsageInput): Promise<ClassicUsage> {
  if (!mainJsonlPath) {
    return { availability: "missing", turnUsages: [], alignment: [], envelopes: [] };
  }

  const { envelopes, rawLineCount } = await readMainJsonlFile(mainJsonlPath);
  const availability = classifyEnvelopesAvailability(envelopes, rawLineCount);
  if (availability !== "events-present") {
    return { availability, turnUsages: [], alignment: [], envelopes };
  }

  const joinAgentTraces = agentTracesDbPath !== undefined;
  const mainTraces = joinAgentTraces ? loadAgentTraceUsageForResponseIds(agentTracesDbPath, collectResponseIds(envelopes)) : undefined;
  const sessionDir = path.dirname(mainJsonlPath);
  const attribution = await attributeSubagentRuns({
    folderId: path.basename(sessionDir),
    refs: collectChildSessionRefs(envelopes),
    logTurnStarts: logTurnStartTimes(envelopes),
    source: folderSubagentLogSource(sessionDir),
    ...(joinAgentTraces
      ? { agentTraceUsage: (responseIds: string[]) => loadAgentTraceUsageForResponseIds(agentTracesDbPath, responseIds) }
      : {}),
  });

  const merged = mergeSubagentUsage(extractTurnUsages(envelopes, mainTraces), attribution.byLogTurn, attribution.unreadByLogTurn);
  const alignment = alignLogTurnsToStore(logTurnDigests(envelopes), storeTurnKeys([...storeTurns]));
  return { availability, turnUsages: placeByStoreIndex(merged, alignment), alignment, attribution, envelopes };
}
