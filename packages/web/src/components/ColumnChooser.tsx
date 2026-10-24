import { useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { REQUIRED_TURN_COLUMN, TURN_COLUMNS, type TurnColumnId } from "../lib/turn-columns.js";

interface ColumnChooserProps {
  visible: readonly TurnColumnId[];
  onChange: (visible: TurnColumnId[]) => void;
}

// The turns table's column chooser (§3.5 Layout, mock-up board 1): a
// "Showing n of m columns" note and a Columns disclosure holding one
// checkbox per column. A disclosure, not a dialog: focus moves freely and
// Escape closes it, back on its button.
export function ColumnChooser({ visible, onChange }: ColumnChooserProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  function toggle(id: TurnColumnId): void {
    const next = visible.includes(id) ? visible.filter((column) => column !== id) : [...visible, id];
    onChange(TURN_COLUMNS.map((column) => column.id).filter((column) => next.includes(column)));
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (open && event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    }
  }

  return (
    <div className="column-chooser" onKeyDown={handleKeyDown}>
      <span className="text-muted" style={{ fontSize: 12 }}>
        Showing {visible.length} of {TURN_COLUMNS.length} columns
      </span>
      <button
        ref={button}
        type="button"
        className="btn btn-secondary"
        style={{ fontSize: 12, padding: "2px 8px" }}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        Columns
      </button>
      {open && (
        <fieldset id={panelId} className="column-chooser-panel">
          <legend className="card-kicker">Visible columns</legend>
          {TURN_COLUMNS.map((column) => (
            <label key={column.id} className="column-chooser-option">
              <input
                type="checkbox"
                checked={column.id === REQUIRED_TURN_COLUMN || visible.includes(column.id)}
                disabled={column.id === REQUIRED_TURN_COLUMN}
                onChange={() => toggle(column.id)}
              />
              {column.label}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
