// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { PriceChangesViewModel } from "../../view-models/index.js";
import { layoutTimeline, timelineEntries } from "./timeline-model.js";
import "./price-changes.css";

// The timeline at the top of U13: one diamond per change on a rail. A
// documented change is a solid diamond, an observed one a dashed hollow
// diamond, so the two kinds differ by shape and stroke, not by colour alone
// (D11). The chart's name counts both kinds; the list below details each.

const WIDTH = 480;
const HEIGHT = 46;
const RAIL_Y = 26;
const HALF = 5;

export function PriceTimeline({ vm }: { vm: PriceChangesViewModel }) {
  const entries = timelineEntries(vm);
  const layout = layoutTimeline(entries, vm.range, WIDTH);
  const name = `Price changes on a timeline, documented solid and inferred dashed: ${vm.documented.length} documented, ${vm.observed.length} inferred`;
  const sameEnds = layout.start.x === layout.end.x;
  return (
    <div className="pc-timeline">
      <svg className="pc-chart" role="img" aria-label={name} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%">
        <line className="pc-rail-line" x1={8} x2={WIDTH - 8} y1={RAIL_Y} y2={RAIL_Y} />
        {layout.marks.map((mark) => {
          const diamond = `${mark.x},${RAIL_Y - HALF - 3} ${mark.x + HALF},${RAIL_Y} ${mark.x},${RAIL_Y + HALF + 3} ${mark.x - HALF},${RAIL_Y}`;
          return (
            <g key={mark.key} data-mark={mark.kind} className={mark.kind === "observed" ? "pc-mark pc-mark-inferred" : "pc-mark"}>
              <title>{mark.title}</title>
              <polygon points={diamond} />
              {mark.labelled && (
                <text x={mark.x} y={13} textAnchor="middle" className="pc-axis">
                  {mark.label}
                </text>
              )}
            </g>
          );
        })}
        <text x={layout.start.x} y={HEIGHT - 2} textAnchor={sameEnds ? "middle" : "start"} className="pc-axis pc-axis-end">
          {layout.start.text}
        </text>
        {!sameEnds && (
          <text x={layout.end.x} y={HEIGHT - 2} textAnchor="end" className="pc-axis pc-axis-end">
            {layout.end.text}
          </text>
        )}
      </svg>
      <ul className="pc-legend" aria-label="Timeline key">
        <li>
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" className="pc-mark">
            <polygon points="6,1 10.5,6 6,11 1.5,6" />
          </svg>
          documented price change
        </li>
        <li>
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" className="pc-mark pc-mark-inferred">
            <polygon points="6,1 10.5,6 6,11 1.5,6" />
          </svg>
          observed price change, inferred
        </li>
      </ul>
    </div>
  );
}
