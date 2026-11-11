// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { StatTile } from "@agent-cost-analyzer/web/ui/StatTile";
import type { AuditTile as AuditTileView } from "../../view-models/index.js";

// A tile: an unknown figure reads "Unknown" in the muted italic, never 0.
export function AuditTile({ label, tile }: { label: string; tile: AuditTileView }) {
  return <StatTile label={label} value={tile.text} note={tile.note} />;
}
