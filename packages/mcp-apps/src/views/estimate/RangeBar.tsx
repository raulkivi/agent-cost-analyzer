// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { formatMoney } from "../../view-models/money.js";
import { rangeBar } from "./range-bar.js";
import "./estimate.css";

// The p50 to p90 range on a 0 to max scale (§4.5). Hatched span with a solid
// border and a direct label at each end, so it reads without colour.

export function RangeBar({ p50, p90, label }: { p50: number; p90: number; label: string }) {
  const bar = rangeBar(p50, p90);
  const usd = (value: number) => formatMoney(value, "USD");
  return (
    <div className="est-bar" role="img" aria-label={label}>
      <span className="est-axis" />
      <span className="est-span" style={{ left: `${bar.startPercent}%`, width: `${bar.endPercent - bar.startPercent}%` }} />
      <span className="est-tick" style={{ left: `${bar.startPercent}%` }} />
      <span className="est-tick" style={{ left: `${bar.endPercent}%` }} />
      <span className="est-label est-label--p50" style={{ left: `${bar.startPercent}%` }}>
        <b>p50</b>
        <br />
        {usd(p50)}
      </span>
      <span className="est-label est-label--p90" style={{ left: `${bar.endPercent}%` }}>
        <b>p90</b>
        <br />
        {usd(p90)}
      </span>
      <span className="est-bound" style={{ left: 0 }}>{usd(0)}</span>
      <span className="est-bound est-bound--max" style={{ left: "100%" }}>{usd(bar.max)}</span>
    </div>
  );
}
