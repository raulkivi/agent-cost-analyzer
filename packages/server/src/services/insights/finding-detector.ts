import type { InsightFinding, InsightSessionRow, InsightToolCallRow, InsightTurnRow } from "@agent-cost-analyzer/domain";
import type { InsightRows, ProviderSessions } from "./insights-dataset-builder.js";

// Phase 9.11 (docs/plans/insights-dashboard.md §4): every detector is an
// independent strategy over the same input (open/closed — the service
// takes a list of them).
export interface DetectorInput {
  sources: ProviderSessions[];
  rows: InsightRows;
}

export interface FindingDetector {
  detect(input: DetectorInput): InsightFinding[];
}

// Parent → children lookups over the flat rows, shared by the detectors.
export interface RowIndex {
  turnsBySession: Map<string, InsightTurnRow[]>;
  callsByTurn: Map<string, InsightToolCallRow[]>;
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}

export function indexRows(rows: InsightRows): RowIndex {
  return {
    turnsBySession: groupBy(rows.turns, (turn) => turn.sessionKey),
    callsByTurn: groupBy(rows.toolCalls, (call) => call.turnKey),
  };
}

export function callsOfSession(index: RowIndex, session: InsightSessionRow): InsightToolCallRow[] {
  return (index.turnsBySession.get(session.key) ?? []).flatMap((turn) => index.callsByTurn.get(turn.key) ?? []);
}
