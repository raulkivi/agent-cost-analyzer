// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { BasisTile } from "../../view-models/index.js";
import "./cost-over-time.css";

// The four cost bases (board): the preferred total first, then billed,
// reported and priced, each with its own coverage. A currency is a line of
// its own; two are never added. Local rather than the shared StatTile because
// a tile here holds one line per currency.

const LABELS: Record<BasisTile["basis"], string> = {
  preferred: "Total · preferred basis",
  billed: "Billed",
  reported: "Reported",
  priced: "Priced",
};

export function BasisTiles({ tiles }: { tiles: BasisTile[] }) {
  return (
    <div className="stat-tiles view-tiles ct-tiles">
      {tiles.map((tile) => (
        <div key={tile.basis} className="stat-tile" role="group" aria-label={LABELS[tile.basis]}>
          <span className="stat-tile-label">{LABELS[tile.basis]}</span>
          {tile.money.map((money) => (
            <span key={money.currency ?? "unknown"}>
              <span className={money.known ? "ct-money" : "ct-money view-unknown"}>{money.text}</span>
              {money.coverageNote !== undefined && <span className="ct-note">{money.coverageNote}</span>}
              {money.unknownNote !== undefined && <span className="ct-note">{money.unknownNote}</span>}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
