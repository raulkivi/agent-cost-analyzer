// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useId, useRef } from "react";
import type { ReplayAssumption, ReplayPriceChannel, SessionReplay } from "@agent-cost-analyzer/domain";
import { useEscapeKey, useFocusTrap } from "../../lib/focus.js";
import {
  currencyLabel,
  formatReplayAmount,
  formatReplayDifference,
  pricedAtSentence,
  selfCheckDetail,
  selfCheckRule,
  splitAssumption,
  subagentRunsCostSentence,
  subagentRunsSentence,
} from "../../lib/replay-format.js";
import { useFirstTimeOpen } from "../../state/use-first-time-open.js";
import { Tag, type TagVariant } from "../ui/Tag.js";
import { SelfCheckLine } from "./ReplaySummaryStrip.js";
import { SimulatedBadge } from "./SimulatedBadge.js";

interface ReplaySummaryPanelProps {
  replay: SessionReplay;
  sessionTitle: string;
  // The replay vendor's display name, for "Anthropic API".
  vendorName: string;
  onPricingChange(pricing: ReplayPriceChannel): void;
  onClose(): void;
}

// Plan §10: shown by default the first time, per viewer.
export const ASSUMPTIONS_SEEN_KEY = "replayAssumptionsSeen";

const CONFIDENCE_VARIANT: Record<ReplayAssumption["confidence"], TagVariant> = {
  documented: "accent",
  inferred: "neutral",
  unknown: "outline",
};

// A4 when the service didn't use it: the log records every write, so none
// are inferred (it adds A4 exactly when some request's write is unknown).
const UNUSED_A4 = {
  id: "A4",
  title: "Inferred cache writes",
  text: "Where the log records no cache writes, writes are what the vendor's rules say they would be. This session's log records its writes, so none are inferred.",
};

function TotalsRow({ replay }: { replay: SessionReplay }) {
  const { totals, currency } = replay;
  const unit = currencyLabel(currency);
  const difference = formatReplayDifference(totals.difference, totals.measured.value, currency);
  const same = `same ${totals.simulated.knownTurns} turns`;
  return (
    <div className="replay-panel-totals">
      <div role="group" aria-label="Measured total" className="replay-total">
        <span className="card-kicker">Measured · {replay.measuredModels.join(", ")}</span>
        <span className="replay-total-value">{formatReplayAmount(totals.measured.value, currency)}</span>
        <span className="text-muted replay-total-note">{unit} · from the log</span>
      </div>
      <div role="group" aria-label="Simulated total" className="replay-total sim-frame">
        <span className="replay-total-head">
          <span className="card-kicker">{replay.model}</span>
          <SimulatedBadge />
        </span>
        <span className="replay-total-value">{formatReplayAmount(totals.simulated.value, currency)}</span>
        <span className="text-muted replay-total-note">
          {unit} · {same}
        </span>
      </div>
      <div role="group" aria-label="Difference, simulated minus measured" className="replay-total">
        <span className="card-kicker">Difference</span>
        <span className="replay-total-value">{difference.amount}</span>
        <span className="text-muted replay-total-note">{difference.percent ? `${difference.percent} · ` : ""}simulated − measured</span>
      </div>
    </div>
  );
}

function PricesSection({ replay, vendorName, onPricingChange }: Pick<ReplaySummaryPanelProps, "replay" | "vendorName" | "onPricingChange">) {
  const headingId = useId();
  const { pricing } = replay;
  const channels: { value: ReplayPriceChannel; label: string }[] = [
    { value: "api", label: `${vendorName} API` },
    { value: "copilot", label: "GitHub Copilot" },
  ];
  return (
    <section className="replay-panel-section" aria-labelledby={headingId}>
      <h3 id={headingId}>Prices</h3>
      <div className="replay-panel-row">
        <span>{pricedAtSentence(pricing, vendorName)}</span>
        <div className="seg" role="radiogroup" aria-label="Price channel">
          {channels.map((channel) => (
            <button
              key={channel.value}
              type="button"
              role="radio"
              aria-checked={pricing.channel === channel.value}
              className={`seg-opt replay-channel${pricing.channel === channel.value ? " replay-channel--on" : ""}`}
              onClick={() => onPricingChange(channel.value)}
            >
              {channel.label}
            </button>
          ))}
        </div>
      </div>
      <span className="text-muted">
        {pricing.channel === null
          ? pricing.reason
          : pricing.requested === "session-channel"
            ? "This session's own channel, at the price on the session's date. Switch to see both totals at the other channel's prices."
            : `Not necessarily this session's own channel: both totals are priced at ${pricing.channel === "copilot" ? "GitHub Copilot's price table, in AI Credits (1 AI Credit = $0.01)" : `the ${vendorName} API's prices, in USD`}.`}
      </span>
    </section>
  );
}

function CoverageSection({ replay }: { replay: SessionReplay }) {
  const headingId = useId();
  const { coverage, turns, totals } = replay;
  const turnsFor = (reason: string) => turns.filter((turn) => turn.notReplayedReason === reason).map((turn) => turn.turnIndex);
  return (
    <section className="replay-panel-section" aria-labelledby={headingId}>
      <h3 id={headingId}>Coverage</h3>
      <span>
        {coverage.replayedTurns} of {coverage.turns} turns replayed ({coverage.replayedRequests} of {coverage.requests} requests)
      </span>
      {subagentRunsSentence(coverage.subagentRuns) !== undefined && (
        <span>
          {subagentRunsSentence(coverage.subagentRuns)}. {subagentRunsCostSentence(coverage.subagentRuns)}
        </span>
      )}
      {coverage.notReplayed.length > 0 && (
        <ul className="replay-panel-list">
          {coverage.notReplayed.map((group) => {
            const numbers = turnsFor(group.reason);
            return (
              <li key={group.reason}>
                <strong>
                  {group.turns} {group.turns === 1 ? "turn" : "turns"}:
                </strong>{" "}
                {group.reason}
                {numbers.length > 0 && <span className="text-muted"> ({numbers.length === 1 ? "turn" : "turns"} {numbers.join(", ")})</span>}
              </li>
            );
          })}
        </ul>
      )}
      <span className="text-muted">
        Both totals cover the same {totals.simulated.knownTurns} turns; turns not replayed, or with an unknown cost, are left out of both.
      </span>
    </section>
  );
}

function SelfCheckSection({ replay }: { replay: SessionReplay }) {
  const headingId = useId();
  const check = replay.selfCheck;
  return (
    <section className="replay-panel-section" aria-labelledby={headingId}>
      <h3 id={headingId}>Self-check</h3>
      <SelfCheckLine replay={replay} />
      {check && <span>{selfCheckDetail(check)}</span>}
      {check && !check.passed && (
        <span>
          The figures for {replay.model}, and for any other model, rest on this check, so read them with care.
        </span>
      )}
      {check ? (
        <span className="text-muted">{selfCheckRule(check)}</span>
      ) : (
        <span className="text-muted">Other models' simulated figures still show, without that evidence behind them.</span>
      )}
    </section>
  );
}

function AssumptionsSection({ assumptions }: { assumptions: ReplayAssumption[] }) {
  const [open, setOpen] = useFirstTimeOpen(ASSUMPTIONS_SEEN_KEY);
  const listId = useId();
  const usedIds = new Set(assumptions.map((assumption) => assumption.id));
  const rows = [
    ...assumptions.map((assumption) => ({ ...assumption, ...splitAssumption(assumption.text), unused: false })),
    ...(usedIds.has("A4") ? [] : [{ ...UNUSED_A4, confidence: "inferred" as const, unused: true }]),
  ].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return (
    <section className="replay-panel-section">
      <h3>
        <button type="button" className="btn btn-ghost replay-disclosure" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span> Assumptions ({assumptions.length})
          <span className="text-muted"> · what a replay can't know</span>
        </button>
      </h3>
      {open && (
        <ul id={listId} className="replay-assumptions" aria-label="Assumptions">
          {rows.map((row) => (
            <li key={row.id} className={`replay-assumption${row.unused ? " replay-assumption--unused" : ""}`}>
              <span className="replay-assumption-head">
                <strong>
                  {row.id}
                  {row.title ? ` · ${row.title}` : ""}
                </strong>
                {row.unused ? (
                  <Tag variant="outline">not used for this session</Tag>
                ) : (
                  <Tag variant={CONFIDENCE_VARIANT[row.confidence]}>{row.confidence}</Tag>
                )}
                {row.id === "A1" && <Tag variant="outline">main caveat</Tag>}
              </span>
              <span>{row.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Mock-up board 2: the full replay summary, as a modal dialog (the app's
// dialogs: focus trapped while open, Escape and the backdrop close it, focus
// goes back to the opener).
export function ReplaySummaryPanel({ replay, sessionTitle, vendorName, onPricingChange, onClose }: ReplaySummaryPanelProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useFocusTrap(dialog);
  useEscapeKey(onClose);
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        ref={dialog}
        className="dialog replay-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="replay-panel-head">
          <div>
            <span className="replay-total-head">
              <span className="card-kicker">Replay summary</span>
              <SimulatedBadge />
            </span>
            <h2 id={titleId} className="dialog-title">
              {sessionTitle} on {replay.model}
            </h2>
            <span id={descriptionId} className="text-muted">
              Measured on {replay.measuredModels.join(", ")} · computed on request, never stored
            </span>
          </div>
          <button type="button" className="btn btn-ghost" aria-label="Close replay summary" onClick={onClose}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <TotalsRow replay={replay} />
        <PricesSection replay={replay} vendorName={vendorName} onPricingChange={onPricingChange} />
        <CoverageSection replay={replay} />
        <SelfCheckSection replay={replay} />
        <AssumptionsSection assumptions={replay.assumptions} />
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
