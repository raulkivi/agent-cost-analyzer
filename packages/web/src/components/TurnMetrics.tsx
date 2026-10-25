import type { Turn } from "@agent-cost-analyzer/domain";
import { TURN_COLUMNS, type TurnColumnId } from "../lib/turn-columns.js";
import { TurnColumnValue } from "./TurnsTable.js";

interface TurnMetricsProps {
  turns: Turn[];
  // Array position of the turn shown.
  turnIndex: number;
  // The columns the table doesn't show at this width.
  columns: readonly TurnColumnId[];
}

const LABELS = new Map<TurnColumnId, string>(TURN_COLUMNS.map((column) => [column.id, column.label]));

// The narrow layout's details drawer: the metrics hidden from the turns
// table, as a definition list (mock-up board 4).
export function TurnMetrics({ turns, turnIndex, columns }: TurnMetricsProps) {
  const turn = turns[turnIndex];
  if (!turn) return null;
  return (
    <dl className="turn-metrics">
      {columns.map((id) => (
        <div key={id}>
          <dt className="text-muted">{LABELS.get(id)}</dt>
          <dd>
            <TurnColumnValue column={id} turn={turn} turnIndex={turnIndex} turns={turns} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
