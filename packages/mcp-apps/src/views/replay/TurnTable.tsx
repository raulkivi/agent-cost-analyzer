// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ReplayTurnRow } from "../../view-models/index.js";
import "./replay.css";

// "View as table" for U12's chart: every turn's measured and simulated
// figure, and for a turn not replayed its reason. Unknown is written, never 0.

export function TurnTable({ turns }: { turns: ReplayTurnRow[] }) {
  return (
    <div className="view-scroll" tabIndex={0} role="region" aria-label="Per-turn credits, scrollable">
      <table className="view-table" aria-label="Per-turn credits, measured and simulated">
        <thead>
          <tr>
            <th className="view-left">Turn</th>
            <th>Measured</th>
            <th>Simulated</th>
            <th className="view-left">Cache</th>
          </tr>
        </thead>
        <tbody>
          {turns.map((turn) => (
            <tr key={turn.turnIndex}>
              <td className="view-left">{turn.turnIndex}</td>
              <td className={turn.measured.known ? undefined : "view-unknown"}>{turn.measured.text}</td>
              <td className={turn.simulated.known ? undefined : "view-unknown"}>{turn.simulated.text}</td>
              <td className="view-left view-cell-text rp-cache">{turn.replayed ? (turn.outcomeText ?? "") : `not replayed: ${turn.notReplayedReason ?? ""}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
