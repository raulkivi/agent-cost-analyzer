// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { Tag } from "@agent-cost-analyzer/web/ui/Tag";
import { useEffect, useRef } from "react";
import type { CostVarianceViewModel } from "../../view-models/index.js";
import { focusIfLost } from "../focus.js";
import "./cost-change.css";

// Documented price changes between the periods (taken from the price book),
// and the "Price changes" control that opens U13, the price timeline, in
// place (A28). The control only reports the click; the parent makes the
// get_price_changes call and keeps U11 mounted, so Back refetches nothing.
// It takes focus when the parent restores U11 after Back.

function lineText(line: CostVarianceViewModel["priceChanges"][number]["lines"][number]): string {
  const change = line.percentText === undefined ? `${line.fromText} → ${line.toText}` : `${line.percentText} (${line.fromText} → ${line.toText})`;
  return `${line.tokenText} ${change}`;
}

function joinNames(models: readonly string[]): string {
  return models.length < 2 ? (models[0] ?? "") : `${models.slice(0, -1).join(", ")} and ${models[models.length - 1]}`;
}

export function PriceChanges({ vm, onOpen, focusOnMount = false }: { vm: CostVarianceViewModel; onOpen: () => void; focusOnMount?: boolean }) {
  const drillDown = vm.priceDrillDown;
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusOnMount) focusIfLost(button.current);
    // Mount only: a later render must not move focus.
  }, []);
  return (
    <section className="view-section" aria-label="Documented price changes between the periods">
      <div className="view-section-head">
        <h2>Documented price changes between the periods</h2>
      </div>
      {vm.priceChanges.length === 0 ? (
        <p className="text-muted">No documented price change between the periods.</p>
      ) : (
        <ul className="cv-price-list">
          {vm.priceChanges.map((change) => (
            <li key={`${change.date}:${change.channel}:${change.modelId}`}>
              <span>
                <b>{`${change.modelId} · ${change.channel} · ${change.dateText}`}</b>{" "}
                <Tag variant="outline" className="view-estimate" title="Taken from the price book, with sources">
                  documented
                </Tag>
              </span>
              <span className="text-muted cv-price-lines">{change.lines.map(lineText).join("; ")}</span>
            </li>
          ))}
        </ul>
      )}
      {drillDown !== undefined && (
        <div className="cv-price-action">
          <button ref={button} type="button" className="btn btn-secondary view-btn" aria-describedby="cv-price-note" onClick={onOpen}>
            Price changes
          </button>
          <span id="cv-price-note" className="cv-price-note text-muted">
            {`Opens the price timeline for ${joinNames(drillDown.models)}, the largest price ${drillDown.models.length === 1 ? "effect" : "effects"}.`}
          </span>
        </div>
      )}
    </section>
  );
}
