// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SeverityTile } from "../../view-models/findings.js";
import { SeverityMark } from "./SeverityMark.js";
import "./findings.css";

// Counts cover every match, not only the rows shown; tiles below the
// minimum severity filter are dimmed.
export function SeverityTiles({ tiles }: { tiles: SeverityTile[] }) {
  return (
    <div className="fv-tiles">
      {tiles.map((tile) => (
        <div key={tile.severity} className={tile.dimmed ? "fv-tile is-dim" : "fv-tile"} role="group" aria-label={tile.label}>
          <span className="fv-tile-label">
            <SeverityMark severity={tile.severity} />
            {tile.label}
          </span>
          <span className="fv-tile-value">{tile.countText}</span>
        </div>
      ))}
    </div>
  );
}
