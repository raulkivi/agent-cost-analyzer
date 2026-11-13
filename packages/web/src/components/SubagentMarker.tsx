// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Turn } from "@agent-cost-analyzer/domain";
import { subagentSummary } from "../lib/subagent-runs.js";

// A fork glyph after a turn's AI Credits when subagent runs are in the figure
// (step 10.19, mock-ups SA0b). The words are in the accessible name and the
// tooltip, so colour is never the only signal; dashed when the figure is unknown.
export function SubagentMarker({ turn }: { turn: Turn }) {
  const summary = subagentSummary(turn);
  if (!summary) return null;
  return (
    <span
      className={summary.unknown ? "subagent-marker subagent-marker--unknown" : "subagent-marker"}
      role="img"
      aria-label={summary.text}
      title={summary.text}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
        <circle cx="4" cy="3.5" r="1.6" />
        <circle cx="12" cy="3.5" r="1.6" />
        <circle cx="8" cy="13" r="1.6" />
        <path d="M4 5.1v1.4c0 1 .8 1.8 1.8 1.8h4.4c1 0 1.8-.8 1.8-1.8V5.1M8 8.3v3.1" />
      </svg>
    </span>
  );
}
