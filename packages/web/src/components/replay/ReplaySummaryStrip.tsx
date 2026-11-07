// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ReplayPriceChannel, SessionReplay } from "@agent-cost-analyzer/domain";
import {
  coverageSentence,
  currencyLabel,
  formatReplayAmount,
  formatReplayDifference,
  pricedAtSentence,
  selfCheckSentence,
} from "../../lib/replay-format.js";
import { Blueprint } from "../ui/Blueprint.js";
import { ReplayPricingNote } from "./ReplayPricingNote.js";
import { SimulatedBadge } from "./SimulatedBadge.js";

interface ReplaySummaryStripProps {
  replay: SessionReplay;
  // The replay vendor's display name, for "the Anthropic API's prices".
  vendorName: string;
  onOpenSummary(): void;
  onPricingChange(pricing: ReplayPriceChannel): void;
}

export function SelfCheckLine({ replay }: { replay: SessionReplay }) {
  const check = replay.selfCheck;
  const state = check === null ? "none" : check.passed ? "passed" : "failed";
  return (
    <span className={`replay-self-check replay-self-check--${state}`}>
      <span aria-hidden="true">{state === "passed" ? "✓" : state === "failed" ? "⚠" : "–"}</span> {selfCheckSentence(check)}
    </span>
  );
}

// Mock-up board 1's summary strip, above the turns table: measured,
// simulated ("would have cost about"), the difference, the coverage, the
// self-check and the prices, and the button to the full summary.
export function ReplaySummaryStrip({ replay, vendorName, onOpenSummary, onPricingChange }: ReplaySummaryStripProps) {
  const { totals, currency } = replay;
  const difference = formatReplayDifference(totals.difference, totals.measured.value, currency);
  const simulated = formatReplayAmount(totals.simulated.value, currency);
  return (
    <Blueprint className="replay-strip">
      <section aria-label="Replay summary" className="replay-strip-body">
        <div role="group" aria-label="Measured total" className="replay-total">
          <span className="card-kicker">Measured · {replay.measuredModels.join(", ")}</span>
          <span className="replay-total-value">{formatReplayAmount(totals.measured.value, currency)}</span>
        </div>
        <div role="group" aria-label="Simulated total" className="replay-total sim-frame">
          <span className="replay-total-head">
            <span className="card-kicker">{replay.model}</span>
            <SimulatedBadge />
          </span>
          <span className="replay-total-value">{simulated}</span>
        </div>
        <div role="group" aria-label="Difference, simulated minus measured" className="replay-total">
          <span className="card-kicker">Difference</span>
          <span className="replay-total-value">
            {difference.amount}{" "}
            <span className="text-muted replay-total-note">
              {difference.percent ? `${difference.percent} · ` : ""}
              {currencyLabel(currency)}
            </span>
          </span>
        </div>
        <div className="replay-strip-lines">
          <span>
            {totals.simulated.value === null
              ? `What this session would have cost on ${replay.model} is unknown.`
              : `This session would have cost about ${simulated} on ${replay.model}.`}
          </span>
          <span>{coverageSentence(replay.coverage)}</span>
          <SelfCheckLine replay={replay} />
          <span className="text-muted">{pricedAtSentence(replay.pricing, vendorName)}</span>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" aria-haspopup="dialog" onClick={onOpenSummary}>
          Replay summary
        </button>
        <ReplayPricingNote replay={replay} vendorName={vendorName} onPricingChange={onPricingChange} />
      </section>
    </Blueprint>
  );
}
