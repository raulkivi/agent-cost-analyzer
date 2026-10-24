import { useRef } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import type { TokenCount, Turn } from "@copilot-cost-analyzer/domain";
import { sumTokenCounts } from "@copilot-cost-analyzer/domain";
import { isFailedStatus } from "@copilot-cost-analyzer/domain";
import { formatAiCredits } from "../lib/format-ai-credits.js";
import { TRIGGER_LABELS } from "../lib/trigger-labels.js";
import { ALL_TURN_COLUMNS, TURN_COLUMNS, type TurnColumnId } from "../lib/turn-columns.js";
import { Tag } from "./ui/Tag.js";

const CUMULATIVE_COST_UNKNOWN_REASON =
  "Cumulative AI Credits is unavailable because at least one earlier turn's cost is unknown.";

function formatTokenCount(tokenCount: TokenCount): string {
  return tokenCount.known ? tokenCount.value.toLocaleString() : "—";
}

// Tool-call count plus a failure badge (Phase 9.10 audit) — icon + number +
// accessible label, so a failed turn stands out without relying on colour.
function ToolCallsCell({ turn }: { turn: Turn }) {
  const failed = turn.toolCalls.filter((call) => call.outcome && isFailedStatus(call.outcome.status)).length;
  return (
    <>
      {turn.toolCalls.length}
      {failed > 0 && (
        <span className="failure-badge" role="img" aria-label={`${failed} of ${turn.toolCalls.length} tool calls failed`}>
          <span aria-hidden="true">✕{failed}</span>
        </span>
      )}
    </>
  );
}

function formatRoundsCount(roundsCount: number | undefined): string {
  return roundsCount === undefined ? "—" : roundsCount.toLocaleString();
}

// Running total through and including this row — all-or-nothing (an
// earlier turn with unknown cost makes every later row's total unknown too).
function cumulativeCostThrough(turns: Turn[], turnIndex: number): TokenCount {
  return sumTokenCounts(
    turns.slice(0, turnIndex + 1).map((turn) => turn.usage.costAiCredits),
    CUMULATIVE_COST_UNKNOWN_REASON,
  );
}

interface CellProps {
  turn: Turn;
  turnIndex: number;
  turns: Turn[];
}

// Each column's value for a turn; the table and the narrow layout's details
// drawer (TurnMetrics) format it the same way.
const VALUES: Record<TurnColumnId, (props: CellProps) => ReactNode> = {
  turn: ({ turn }) => turn.index,
  trigger: ({ turn }) =>
    turn.triggeredEvent ? (
      <Tag variant="outline">{TRIGGER_LABELS[turn.triggeredEvent]}</Tag>
    ) : (
      <span className="text-muted">—</span>
    ),
  rounds: ({ turn }) => formatRoundsCount(turn.usage.roundsCount),
  calls: ({ turn }) => <ToolCallsCell turn={turn} />,
  uncachedInput: ({ turn }) => formatTokenCount(turn.usage.uncachedInput),
  cacheRead: ({ turn }) => formatTokenCount(turn.usage.cacheRead),
  cacheWrite: ({ turn }) => formatTokenCount(turn.usage.cacheWrite),
  tool: ({ turn }) => formatTokenCount(turn.usage.tool),
  vision: ({ turn }) => formatTokenCount(turn.usage.vision),
  reasoning: ({ turn }) => formatTokenCount(turn.usage.reasoning),
  output: ({ turn }) => formatTokenCount(turn.usage.output),
  aiCredits: ({ turn }) => formatAiCredits(turn.usage.costAiCredits),
  cumulative: ({ turns, turnIndex }) => formatAiCredits(cumulativeCostThrough(turns, turnIndex)),
  model: ({ turn }) => turn.usage.model,
};

export function TurnColumnValue({ column, ...props }: CellProps & { column: TurnColumnId }) {
  return <>{VALUES[column](props)}</>;
}

// The table cell's own look, per column.
const CELL_STYLES: Partial<Record<TurnColumnId, { className?: string; style?: CSSProperties }>> = {
  trigger: { className: "truncate", style: { maxWidth: 100 } },
  calls: { style: { whiteSpace: "nowrap" } },
  cumulative: { className: "text-muted" },
  model: { className: "text-muted truncate", style: { fontSize: 12, maxWidth: 110 } },
};

const LABELS = new Map<TurnColumnId, string>(TURN_COLUMNS.map((column) => [column.id, column.label]));

// Below this many columns the table needn't be forced wider than its panel.
const MIN_WIDTH_ALL_COLUMNS = 760;

interface TurnsTableProps {
  turns: Turn[];
  selectedTurnIndex: number;
  onSelectTurn: (turnIndex: number) => void;
  // Enter on a row (§3.5): opens the turn's details where the layout has a
  // drawer for them; without it, Enter only selects.
  onOpenTurn?: (turnIndex: number) => void;
  // Visible columns, in display order (the column chooser, or the narrow
  // layout's priority columns). Omitted, all of them.
  columns?: readonly TurnColumnId[];
}

export function TurnsTable({
  turns,
  selectedTurnIndex,
  onSelectTurn,
  onOpenTurn,
  columns = ALL_TURN_COLUMNS,
}: TurnsTableProps) {
  const rows = useRef<(HTMLTableRowElement | null)[]>([]);
  // Roving tabindex: the table is one Tab stop, entered at the selected row.
  const tabStop = selectedTurnIndex >= 0 && selectedTurnIndex < turns.length ? selectedTurnIndex : 0;

  function moveTo(turnIndex: number): void {
    const target = Math.min(Math.max(turnIndex, 0), turns.length - 1);
    rows.current[target]?.focus();
    onSelectTurn(target);
  }

  function handleKeyDown(event: KeyboardEvent, turnIndex: number): void {
    const targets: Record<string, number> = {
      ArrowDown: turnIndex + 1,
      ArrowUp: turnIndex - 1,
      Home: 0,
      End: turns.length - 1,
    };
    if (event.key in targets) {
      event.preventDefault();
      moveTo(targets[event.key]!);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectTurn(turnIndex);
      if (event.key === "Enter") onOpenTurn?.(turnIndex);
    }
  }

  return (
    <table className="table" style={columns.length === ALL_TURN_COLUMNS.length ? { minWidth: MIN_WIDTH_ALL_COLUMNS } : undefined}>
      <thead>
        <tr>
          {columns.map((id) => (
            <th key={id} scope="col">
              {LABELS.get(id)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {turns.map((turn, turnIndex) => (
          <tr
            key={turn.index}
            ref={(element) => {
              rows.current[turnIndex] = element;
            }}
            aria-selected={turnIndex === selectedTurnIndex}
            tabIndex={turnIndex === tabStop ? 0 : -1}
            style={{
              cursor: "pointer",
              background: turnIndex === selectedTurnIndex ? "var(--color-accent-100)" : undefined,
            }}
            onClick={() => onSelectTurn(turnIndex)}
            onKeyDown={(event) => handleKeyDown(event, turnIndex)}
          >
            {columns.map((id) => (
              <td key={id} {...CELL_STYLES[id]}>
                <TurnColumnValue column={id} turn={turn} turnIndex={turnIndex} turns={turns} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
