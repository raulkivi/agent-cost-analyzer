// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ReplayPriceChannel, SessionReplay } from "@agent-cost-analyzer/domain";

interface ReplayPricingNoteProps {
  replay: SessionReplay;
  vendorName: string;
  onPricingChange(pricing: ReplayPriceChannel): void;
}

// Why simulated figures have no price (boards 4d and 4e): no channel is
// known (the API's reason), or the channel has no price on the session's
// date (each turn's reason). The tokens are still simulated and shown.
export function unpricedReasons(replay: SessionReplay): string[] {
  if (replay.pricing.channel === null) return replay.pricing.reason ? [replay.pricing.reason] : [];
  const reasons = replay.turns.flatMap((turn) => (turn.simulated && !turn.simulated.cost.known ? [`unknown: ${turn.simulated.cost.reason}`] : []));
  return [...new Set(reasons)];
}

export function ReplayPricingNote({ replay, vendorName, onPricingChange }: ReplayPricingNoteProps) {
  const reasons = unpricedReasons(replay);
  if (reasons.length === 0) return null;
  const channel = replay.pricing.channel;
  const other: ReplayPriceChannel | null = channel === "api" ? "copilot" : channel === "copilot" ? "api" : null;
  return (
    <div className="replay-note replay-note--warn">
      <p role="status" style={{ margin: 0 }}>
        <span className="replay-note-tag">Unpriced</span> {reasons.join(" ")}
      </p>
      {other && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPricingChange(other)}>
          {other === "copilot" ? "Price at GitHub Copilot's prices instead" : `Price at the ${vendorName} API's prices instead`}
        </button>
      )}
    </div>
  );
}
