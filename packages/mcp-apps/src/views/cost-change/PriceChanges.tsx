// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { Tag } from "@agent-cost-analyzer/web/ui/Tag";
import type { CostVarianceViewModel } from "../../view-models/index.js";
import "./cost-change.css";

// Documented price changes between the periods (taken from the price book),
// and the "Price changes" control the board draws. U13, the price timeline
// it would open, is Increment 3 (A28), so the control is drawn disabled
// with a note and calls nothing. A28 swaps in the get_price_changes
// drill-down and its security review.

function lineText(line: CostVarianceViewModel["priceChanges"][number]["lines"][number]): string {
  const change = line.percentText === undefined ? `${line.fromText} → ${line.toText}` : `${line.percentText} (${line.fromText} → ${line.toText})`;
  return `${line.tokenText} ${change}`;
}

function joinNames(models: readonly string[]): string {
  return models.length < 2 ? (models[0] ?? "") : `${models.slice(0, -1).join(", ")} and ${models[models.length - 1]}`;
}

export function PriceChanges({ vm }: { vm: CostVarianceViewModel }) {
  const drillDown = vm.priceDrillDown;
  return (
    <section className="view-section" aria-label="Documented price changes between the periods">
      <div className="view-section-head">
        <h2>Documented price changes between the periods</h2>
      </div>
      {vm.priceChanges.length === 0 ? (
        <p className="text-muted">No documented price change between the periods.</p>
      ) : (
        <ul className="cc-price-list">
          {vm.priceChanges.map((change) => (
            <li key={`${change.date}:${change.channel}:${change.modelId}`}>
              <span>
                <b>{`${change.modelId} · ${change.channel} · ${change.dateText}`}</b>{" "}
                <Tag variant="outline" className="view-estimate" title="Taken from the price book, with sources">
                  documented
                </Tag>
              </span>
              <span className="text-muted cc-price-lines">{change.lines.map(lineText).join("; ")}</span>
            </li>
          ))}
        </ul>
      )}
      {drillDown !== undefined && (
        <div className="cc-price-action">
          <button type="button" className="btn btn-secondary view-btn" disabled aria-describedby="cc-price-note">
            Price changes
          </button>
          <span id="cc-price-note" className="cc-price-note text-muted">
            {`The price timeline is not available yet. It will open the timeline for ${joinNames(drillDown.models)}, the largest price ${drillDown.models.length === 1 ? "effect" : "effects"}.`}
          </span>
        </div>
      )}
    </section>
  );
}
