// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";

interface StatTileProps {
  label: string;
  value: string;
  note?: ReactNode;
  // Only for a value that is bad news (e.g. a non-zero failure rate).
  alert?: boolean;
  // Hover text for a figure that has a second unit (e.g. AI Credits in USD).
  title?: string;
  // Spans two grid columns, for a value too long for one (the Cost tile).
  wide?: boolean;
}

export function StatTile({ label, value, note, alert = false, title, wide = false }: StatTileProps) {
  return (
    <div className={wide ? "stat-tile stat-tile--wide" : "stat-tile"} role="group" aria-label={label} title={title}>
      <span className="stat-tile-label">{label}</span>
      <span className={alert ? "stat-tile-value stat-tile-value--alert" : "stat-tile-value"}>{value}</span>
      {note && <span className="stat-tile-note">{note}</span>}
    </div>
  );
}
