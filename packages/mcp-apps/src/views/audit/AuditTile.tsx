// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { StatTile } from "@agent-cost-analyzer/web/ui/StatTile";
import type { AuditTile as AuditTileView } from "../../view-models/index.js";

// A tile: an unknown figure reads "Unknown" in the muted italic, never 0.
export function AuditTile({ label, tile }: { label: string; tile: AuditTileView }) {
  // The sub-line ("incl. 83 calls from 3 subagent runs") sits under the figure.
  const note =
    tile.subline === undefined ? (
      tile.note
    ) : (
      <>
        {tile.note !== undefined && <span className="au-tile-note">{tile.note}</span>}
        <span className="au-subline">{tile.subline}</span>
      </>
    );
  return <StatTile label={label} value={tile.text} note={note} />;
}
