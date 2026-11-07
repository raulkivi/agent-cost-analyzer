// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ShareRow } from "../../view-models/index.js";
import "./cost-rollup.css";

// Spend by model or provider: a label, a bar sized against the largest known
// share, the AI Credits and the share of the total. A row whose spend is
// unknown reads "Unknown" and has no bar, never an empty zero bar
// (constraint 6).

export function ShareBars({ label, rows }: { label: string; rows: ShareRow[] }) {
  if (rows.length === 0) return <p className="text-muted">None.</p>;
  const largest = Math.max(0, ...rows.map((row) => row.share ?? 0));
  return (
    <ul className="rv-bars" aria-label={label}>
      {rows.map((row) => (
        <li key={row.label} className="rv-bar-row">
          <span className="rv-bar-label" title={row.label}>
            {row.label}
          </span>
          <span className="rv-bar-track">
            {row.share !== null && largest > 0 && <span data-bar="" className="rv-bar-fill" style={{ width: `${Math.max(1, (row.share / largest) * 100)}%` }} />}
          </span>
          {!row.aiCredits.known && row.share === null ? (
            // An unknown spend has an unknown share: one "Unknown" across both
            // columns, which two narrow columns could not hold side by side
            // (A14 visual check). The share is still read out.
            <span className="rv-bar-unknown view-unknown">
              {row.aiCredits.text}
              <span className="sr-only"> share {row.shareText}</span>
            </span>
          ) : (
            <>
              <span className={row.aiCredits.known ? "rv-bar-value" : "rv-bar-value view-unknown"}>{row.aiCredits.text}</span>
              <span className={row.share === null ? "rv-bar-share view-unknown" : "rv-bar-share text-muted"}>{row.shareText}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
