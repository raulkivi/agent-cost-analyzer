// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { Tag } from "@agent-cost-analyzer/web/ui/Tag";
import type { PriceMarker } from "../../view-models/index.js";
import { describeDocumented, describeObserved } from "./chart-model.js";
import "./cost-over-time.css";

// The price changes behind the chart's markers. A documented change comes
// from the price book; an observed one is inferred from billed against priced
// figures and says so: a dashed rule and the "inferred" tag (plan §4.5).

export function PriceChangeList({ markers }: { markers: PriceMarker[] }) {
  return (
    <ul className="ct-changes" aria-label="Price changes in this range">
      {markers.map((marker) => (
        <li key={`${marker.kind}-${marker.date}-${marker.modelId}`} className={marker.inferred ? "ct-change ct-change-inferred" : "ct-change"}>
          <span className="ct-change-head">
            <span>{`${marker.modelId} · ${marker.channel} · ${marker.kind === "observed" ? `from the week of ${marker.dateText}` : marker.dateText}`}</span>
            {marker.inferred ? (
              <Tag variant="outline" className="view-estimate" title="Inferred from billed against priced figures, not documented in the price book">
                inferred
              </Tag>
            ) : (
              <Tag variant="neutral" className="view-estimate">
                documented
              </Tag>
            )}
          </span>
          <span className="text-muted">{marker.kind === "observed" ? describeObserved(marker) : describeDocumented(marker)}</span>
        </li>
      ))}
    </ul>
  );
}
