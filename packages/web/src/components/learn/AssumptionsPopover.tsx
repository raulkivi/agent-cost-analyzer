// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { Assumption } from "@agent-cost-analyzer/domain";
import { Tag, type TagVariant } from "../ui/Tag.js";

interface AssumptionsPopoverProps {
  assumptions: Assumption[];
}

// "unknown" stands out: it marks what the simulation guesses at.
const CONFIDENCE_VARIANT: Record<Assumption["confidence"], TagVariant> = {
  documented: "accent",
  inferred: "neutral",
  unknown: "outline",
};

// Inline rather than floating, so it can't clip at narrow panel widths (10.11).
export function AssumptionsPopover({ assumptions }: AssumptionsPopoverProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  if (assumptions.length === 0) return null;

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && open) {
      setOpen(false);
      buttonRef.current?.focus();
    }
  }

  const count = assumptions.length;
  return (
    <div className="assumptions" onKeyDown={handleKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-ghost"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">ⓘ</span> {count}{" "}
        {count === 1 ? "assumption" : "assumptions"}
      </button>
      {open && (
        <div id={panelId} className="drawer drawer--inline">
          <ul className="assumptions-list">
            {assumptions.map((assumption) => (
              <li key={assumption.text}>
                <Tag variant={CONFIDENCE_VARIANT[assumption.confidence]}>
                  {assumption.confidence}
                </Tag>{" "}
                {assumption.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
