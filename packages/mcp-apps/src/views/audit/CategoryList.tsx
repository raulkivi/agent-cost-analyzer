// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CategoryBars } from "../../view-models/index.js";
import "./audit.css";

// Failure categories: the category's name, a bar sized against the largest and
// the count in text, so the figure never depends on the bar's colour or length
// (chart-marks rule, D11). One mark colour; the category is named, not coded.

export function CategoryList({ categories }: { categories: CategoryBars }) {
  if (categories.rows.length === 0) return <p className="text-muted">{categories.emptyText}</p>;
  return (
    <ul className="au-bars" aria-label={categories.title}>
      {categories.rows.map((row) => (
        <li key={row.label} className="au-bar-row">
          <span className="au-bar-label" title={row.label}>
            {row.label}
          </span>
          <span className="au-bar-track">
            <span data-bar="" className="au-bar-fill" style={{ width: `${Math.max(1, row.fraction * 100)}%` }} />
          </span>
          <span className="au-bar-value">{row.count}</span>
        </li>
      ))}
    </ul>
  );
}
