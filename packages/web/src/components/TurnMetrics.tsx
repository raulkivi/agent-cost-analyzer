// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SessionReplay, Turn } from "@agent-cost-analyzer/domain";
import { ALL_TURN_COLUMN_LABELS, columnsApplyingTo, isReplayColumn, type TurnColumnId } from "../lib/turn-columns.js";
import { TurnColumnValue } from "./TurnsTable.js";

interface TurnMetricsProps {
  turns: Turn[];
  // Array position of the turn shown.
  turnIndex: number;
  // The columns the table doesn't show at this width.
  columns: readonly TurnColumnId[];
  // The replay shown (step 14.7), for its hidden simulated figures.
  replay?: SessionReplay;
}

// The narrow layout's details drawer: the metrics hidden from the turns
// table, as a definition list (mock-up board 4).
export function TurnMetrics({ turns, turnIndex, columns, replay }: TurnMetricsProps) {
  const turn = turns[turnIndex];
  if (!turn) return null;
  const replayTurn = replay?.turns.find((candidate) => candidate.turnIndex === turn.index);
  return (
    <dl className="turn-metrics">
      {columnsApplyingTo(columns, turn.simulation !== undefined, replay !== undefined).map((id) => (
        <div key={id} className={isReplayColumn(id) ? "sim-cell" : undefined}>
          <dt className="text-muted">{ALL_TURN_COLUMN_LABELS.get(id)}</dt>
          <dd>
            <TurnColumnValue column={id} turn={turn} turnIndex={turnIndex} turns={turns} replayTurn={replayTurn} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
