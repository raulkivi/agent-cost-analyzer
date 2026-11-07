// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ALL_TURN_COLUMN_LABELS, ALL_TURN_COLUMNS, columnsApplyingTo, REQUIRED_TURN_COLUMNS, type TurnColumnId } from "../lib/turn-columns.js";

interface ColumnChooserProps {
  visible: readonly TurnColumnId[];
  onChange: (visible: TurnColumnId[]) => void;
  // The session is simulated, so the Cache column exists; otherwise it is
  // neither listed nor counted.
  simulated?: boolean;
  // A replay is shown (step 14.7), so its simulated columns exist.
  replayed?: boolean;
}

// The turns table's column chooser (§3.5 Layout, mock-up board 1): a
// "Showing n of m columns" note and a Columns disclosure holding one
// checkbox per column. A disclosure, not a dialog: focus moves freely;
// Escape closes it, back on its button, and a click outside closes it
// without touching the focus.
export function ColumnChooser({ visible, onChange, simulated = false, replayed = false }: ColumnChooserProps) {
  const columns = columnsApplyingTo(ALL_TURN_COLUMNS, simulated, replayed).map((id) => ({ id, label: ALL_TURN_COLUMN_LABELS.get(id) }));
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);

  // A pointerdown anywhere else closes the panel. Unlike Escape it doesn't
  // move the focus: the click has already put it where the person wants it.
  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: PointerEvent): void {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  function toggle(id: TurnColumnId): void {
    const next = visible.includes(id) ? visible.filter((column) => column !== id) : [...visible, id];
    // Every id in display order, those not listed now (e.g. the simulated
    // group without a replay) kept as they were.
    onChange(ALL_TURN_COLUMNS.filter((column) => next.includes(column)));
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (open && event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    }
  }

  return (
    <div ref={root} className="column-chooser" onKeyDown={handleKeyDown}>
      <span className="text-muted" style={{ fontSize: 12 }}>
        Showing {columnsApplyingTo(visible, simulated, replayed).length} of {columns.length} columns
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
          {columns.map((column) => (
            <label key={column.id} className="column-chooser-option">
              <input
                type="checkbox"
                checked={REQUIRED_TURN_COLUMNS.includes(column.id) || visible.includes(column.id)}
                disabled={REQUIRED_TURN_COLUMNS.includes(column.id)}
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
