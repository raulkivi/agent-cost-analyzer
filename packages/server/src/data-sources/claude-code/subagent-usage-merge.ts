// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { TurnUsage } from "@agent-cost-analyzer/domain";
import { mergeSubagentUsage } from "../jsonl/subagent-usage-merge.js";
import type { ClaudeCodeSubagentAttribution } from "./subagent-attribution.js";

// Folds a Claude Code session's subagent runs into the turns that started
// them (plan sections 5.4 and 5.5), with the merge Copilot uses (step 10.19):
// the row is own + runs, `ownUsage` keeps the main agent's figures, `model`
// and `roundsCount` stay the main agent's, and `turnLinesOf` splits the row
// into the main agent's line and one line per run.
//
// An unknown run is an unknown part of its turn, so no known total leaves a
// round out. Nothing is "unread" here: the attribution already stands an
// unknown run on the turn for every transcript it could not read or place. A
// session-level reason (`sessionUnknownReasons`) belongs to no turn: the caller
// makes the session's totals unknown from it.
//
// `turnUsages` is indexed by turn, as `attribution.byTurn` is.
export function mergeClaudeCodeSubagentUsage(
  turnUsages: readonly (TurnUsage | null)[],
  attribution: Pick<ClaudeCodeSubagentAttribution, "byTurn">,
): (TurnUsage | null)[] {
  const runsByTurn = new Map([...attribution.byTurn].map(([turn, { runs }]) => [turn, runs] as const));
  return mergeSubagentUsage(turnUsages, runsByTurn, new Map());
}
