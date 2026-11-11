// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostEstimate } from "@agent-cost-analyzer/domain";
import { StatTile } from "@agent-cost-analyzer/web/ui/StatTile";
import { useMemo } from "react";
import type { ViewBrand } from "../brand/view-brand.js";
import type { AppHostPort, ToolResult } from "../host/app-host-port.js";
import { UNKNOWN_TEXT } from "../view-models/format.js";
import { toEstimateViewModel } from "../view-models/index.js";
import type { EstimateViewModel } from "../view-models/index.js";
import { NoViewState } from "./NoViewState.js";
import { withoutStop } from "./sentence.js";
import { ErrorBox } from "./SessionCostView.js";
import { ViewShell } from "./ViewShell.js";
import { RangeBar } from "./estimate/RangeBar.js";
import { parseCostEstimate } from "./estimate/parse-estimate.js";
import "./estimate/estimate.css";

// U15, the cost of planned work (plan §4.5, §9.2 Q15/Q16, board
// Increment3States.dc.html). Standalone only (the extension gets the neutral
// state and none of the result). Always a p50-p90 range tagged "estimate",
// never one number, and no run rate (Q15). A refusal shows its reason and
// every figure Unknown. On another model the figures are Simulated (Q16).
// Read-only, no host call. Target and reason text is logged or configured:
// displayed, never sent to the host's model (§6).

const KICKER = "Estimate";

const WARN_ICON = (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4" />
    <path d="M12 17v.5" />
  </svg>
);

// "$9.50 – $21.00 per active day" into the range and the unit.
function splitUnit(text: string): { value: string; unit: string } {
  const at = text.indexOf(" per ");
  return at < 0 ? { value: text, unit: "planned unit" } : { value: text.slice(0, at), unit: text.slice(at + 5) };
}

function Tiles({ vm, noun }: { vm: EstimateViewModel; noun: string }) {
  const { value } = splitUnit(vm.unitCostText);
  const [seen = "", priced = ""] = vm.sample.unitsText.split(", ");
  const known = value !== UNKNOWN_TEXT;
  return (
    <div className="stat-tiles view-tiles est-tiles">
      {vm.refused && <StatTile label="Estimate" value={UNKNOWN_TEXT} note="no range without enough history" />}
      <StatTile label={`Cost per ${noun}`} value={value} note={known ? (vm.simulation ? `p50 – p90, simulated on ${vm.simulation.model}` : "p50 – p90 of the fully priced history") : "Unknown, not 0"} />
      <StatTile label="History used" value={seen.replace(/ seen$/, "")} note={`${priced} · ${vm.sample.turnsText}`} />
      <StatTile label="Planned" value={vm.plannedText} note="from the question" />
    </div>
  );
}

function Range({ vm, estimate }: { vm: EstimateViewModel; estimate: CostEstimate }) {
  if (estimate.range === null) return null;
  const { p50, p90 } = estimate.range;
  return (
    <section className="est-section" aria-label="Estimated range">
      <h2>{`About ${vm.p50Text} to ${vm.p90Text} USD`}</h2>
      <span className="text-muted">a range, not a forecast of one number</span>
      <RangeBar p50={p50} p90={p90} label={`Estimated range ${vm.p50Text} to ${vm.p90Text} USD, p50 to p90`} />
      <p className="est-note text-muted">{`Typical (p50) ${vm.p50Text}; high case (p90) ${vm.p90Text}. Half of comparable stretches cost less than the p50, nine in ten less than the p90. USD at ${vm.pricingText}. ${vm.conversionNote}`}</p>
    </section>
  );
}

function Refusal({ vm }: { vm: EstimateViewModel }) {
  return (
    <div className="est-alert" role="status">
      {WARN_ICON}
      <div>
        <b>Not enough history to give an estimate.</b> {withoutStop(vm.refusal ?? "There is too little priced history")}. No range is shown rather than a guess.
      </div>
    </div>
  );
}

function Simulated({ vm, estimate }: { vm: EstimateViewModel; estimate: CostEstimate }) {
  const sim = vm.simulation;
  if (sim === undefined) return null;
  const check = estimate.simulation?.selfCheck;
  const failed = check === undefined ? 0 : check.checked - check.passed;
  return (
    <section className="est-section" aria-label="Simulated">
      <h2>{`Simulated on ${sim.model}`}</h2>
      <ul className="est-list">
        <li>{`${sim.sessionsText}; ${sim.turnsText}.`}</li>
        {sim.notReplayed.map((group, index) => (
          <li key={`${index}:${group.reason}`}>{`${group.turnsText} not replayed: ${withoutStop(group.reason)}.`}</li>
        ))}
        <li>{`Priced as each session was used.`}</li>
        <li>
          {`Self-check: ${sim.selfCheckText}.`}
          {failed > 0 && <b className="est-failed">{` ${failed} failed, so the range may be off.`}</b>}
        </li>
        {sim.assumptions.map((assumption) => (
          <li key={assumption.id}>{`Assumes: ${assumption.text} (${assumption.confidenceText})`}</li>
        ))}
      </ul>
    </section>
  );
}

function EstimateBody({ brand, result }: { brand: ViewBrand; result: ToolResult | undefined }) {
  const estimate = useMemo(() => (result === undefined || result.isError ? undefined : parseCostEstimate(result.structuredContent)), [result]);
  const vm = useMemo(() => (estimate === undefined ? undefined : toEstimateViewModel(estimate)), [estimate]);

  if (result === undefined) {
    return (
      <ViewShell brand={brand} kicker={KICKER} title="Estimate">
        <p role="status" className="text-muted">
          Waiting for the estimate…
        </p>
      </ViewShell>
    );
  }
  if (estimate === undefined || vm === undefined) {
    const reason = result.isError ? result.errorText?.trim() : undefined;
    return (
      <ViewShell brand={brand} kicker={KICKER} title="Estimate">
        <ErrorBox title="Couldn't show the estimate.">
          {reason ? `The tool returned an error: ${reason.slice(0, 500)}` : "estimate_cost returned an error or a result this view can't read. The text answer above has the reason; check the project id."}
        </ErrorBox>
      </ViewShell>
    );
  }

  const title = vm.simulation ? `Estimate on ${vm.simulation.model}` : `Estimate for ${vm.targetName}`;
  return (
    <ViewShell
      brand={brand}
      kicker={KICKER}
      title={title}
      meta={`${vm.plannedText} planned · ${vm.windowText} · ${vm.pricingText}`}
    >
      <p className="est-note">
        <span className="est-tag">{vm.label}</span>
        {vm.simulation && <span className="est-tag" title="Simulated: assumes the same conversation and token counts">{vm.simulation.label}</span>}
        {vm.simulation && <span className="text-muted">{` for ${vm.targetName}`}</span>}
      </p>
      {vm.refused ? <Refusal vm={vm} /> : <Range vm={vm} estimate={estimate} />}
      <Tiles vm={vm} noun={estimate.unit === "activeDays" ? "active day" : "session"} />
      <Simulated vm={vm} estimate={estimate} />
      {vm.refused ? (
        <p className="est-note text-muted">Ask again with the 12-week window, or by sessions instead of active days.</p>
      ) : (
        <p className="est-note text-muted">{`An estimate from the target's own history. It can be off when the planned work differs from past work.`}</p>
      )}
    </ViewShell>
  );
}

export function EstimateView({ brand, result }: { port: AppHostPort; brand: ViewBrand; result: ToolResult | undefined }) {
  if (brand.productId !== "standalone") return <NoViewState brand={brand} />;
  return <EstimateBody brand={brand} result={result} />;
}
