// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { Tag } from "@agent-cost-analyzer/web/ui/Tag";
import { useId, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ViewBrand } from "../../brand/view-brand.js";
import type { ReplayDetailViewModel } from "../../view-models/index.js";
import { ViewShell } from "../ViewShell.js";
import { Callout } from "./Callout.js";
import { ReplayChart } from "./ReplayChart.js";
import { TurnTable } from "./TurnTable.js";
import { buildReplayChart } from "./chart-model.js";
import "./replay.css";

// U12's replay mode (board Replay, plan §9.2 Q2, Q3, Q5): the self-check
// first, then Measured, Simulated and Difference, the per-turn chart, the
// turns not replayed with their reasons, and the assumptions collapsed. A
// failed self-check does not hide the figures: it sits above them as an alert
// and they keep their Simulated tag.

export function SimulatedTag() {
  return (
    <Tag variant="outline" className="view-estimate rp-simulated" title="Simulated: assumes the same conversation and token counts">
      Simulated
    </Tag>
  );
}

function turnList(indexes: readonly number[]): string {
  if (indexes.length === 1) return `turn ${indexes[0]}`;
  if (indexes.length <= 6) return `turns ${indexes.slice(0, -1).join(", ")} and ${indexes[indexes.length - 1]}`;
  return `turns ${indexes.slice(0, 5).join(", ")} and ${indexes.length - 5} more`;
}

function Tile({ label, tag, children, note }: { label: string; tag?: boolean; children: ReactNode; note?: string | undefined }) {
  return (
    <div className="stat-tile rp-tile" role="group" aria-label={label}>
      <span className="stat-tile-label">
        {label}
        {tag && (
          <>
            {" "}
            <SimulatedTag />
          </>
        )}
      </span>
      {children}
      {note !== undefined && <span className="rp-note">{note}</span>}
    </div>
  );
}

function SelfCheckBox({ vm }: { vm: ReplayDetailViewModel }) {
  const { selfCheck } = vm;
  const tone = selfCheck.status === "passed" ? "ok" : selfCheck.status === "failed" ? "fail" : "warn";
  return (
    <Callout tone={tone} title={selfCheck.title} alert={selfCheck.callout}>
      {selfCheck.detail}
    </Callout>
  );
}

function Tiles({ vm }: { vm: ReplayDetailViewModel }) {
  const { measured, simulated, difference } = vm;
  const direction = difference.amount === null || difference.amount === 0 ? "none" : difference.amount < 0 ? "decrease" : "increase";
  const measuredNote = measured.known ? (measured.coverageNote ?? `known for all ${vm.turns.length} turns`) : measured.unknownNote;
  const simulatedNote = simulated.known ? `${vm.coverage.text} · would have cost about` : `${vm.coverage.text}, none priced`;
  const differenceNote = [vm.differencePercentText, vm.differenceNote, difference.known ? undefined : "needs both totals"].filter((part) => part !== undefined).join(" · ");
  return (
    <div className="stat-tiles rp-tiles">
      <Tile label={vm.measuredBasisText === undefined ? "Measured" : `Measured · ${vm.measuredBasisText}`} note={measuredNote}>
        <span className={measured.known ? "rp-money" : "rp-money view-unknown"}>{measured.text}</span>
      </Tile>
      <Tile label={`Simulated on ${vm.model}`} tag note={simulatedNote}>
        <span className={simulated.known ? "rp-money" : "rp-money view-unknown"}>{simulated.text}</span>
      </Tile>
      <Tile label="Difference" note={differenceNote === "" ? undefined : differenceNote}>
        <span className={difference.known ? `rp-money rp-money--${direction}` : "rp-money view-unknown"}>{difference.text}</span>
      </Tile>
    </div>
  );
}

function NotReplayed({ vm }: { vm: ReplayDetailViewModel }) {
  const missed = vm.turns.filter((turn) => !turn.replayed);
  return (
    <section className="view-section" aria-label="Not replayed">
      <div className="view-section-head">
        <h2>Not replayed</h2>
        <span className="text-muted">{`${missed.length} of ${vm.turns.length} turns`}</span>
      </div>
      <ul className="rp-reasons">
        {vm.coverage.notReplayed.map((group) => (
          <li key={group.reason}>{`${group.turnsText}: ${group.reason} (${turnList(missed.filter((turn) => turn.notReplayedReason === group.reason).map((turn) => turn.turnIndex))})`}</li>
        ))}
      </ul>
      <p className="rp-basis text-muted">Their simulated cost is Unknown, not 0.</p>
    </section>
  );
}

function Assumptions({ vm }: { vm: ReplayDetailViewModel }) {
  if (vm.assumptions.length === 0) return null;
  const count = vm.assumptions.length;
  return (
    <details className="rp-assumptions">
      <summary>{`Show ${count} assumption${count === 1 ? "" : "s"}`}</summary>
      <ul>
        {vm.assumptions.map((assumption) => (
          <li key={assumption.id}>{`${assumption.id}: ${assumption.text} · confidence: ${assumption.confidenceText}`}</li>
        ))}
      </ul>
    </details>
  );
}

export function ReplayDetail({ brand, vm, kicker, lead }: { brand: ViewBrand; vm: ReplayDetailViewModel; kicker: string; lead?: ReactNode }) {
  const chart = useMemo(() => buildReplayChart(vm.turns, vm.currency), [vm]);
  const [table, setTable] = useState(false);
  const tableId = useId();
  const unitLabel = chart.unitLabel;
  const hasChart = chart.simulated.length > 0;
  const meta = `Session ${vm.sessionId} · measured on ${vm.measuredModelsText} · ${vm.pricingText}`;
  return (
    <ViewShell
      brand={brand}
      kicker={kicker}
      title={`Replay on ${vm.model}`}
      meta={meta}
      lead={lead}
      titleTag={<SimulatedTag />}
    >
      <SelfCheckBox vm={vm} />
      <Tiles vm={vm} />

      <section className="view-section" aria-label={`${unitLabel} per turn`}>
        <div className="view-section-head">
          <h2>{`${unitLabel} per turn`}</h2>
          <span className="text-muted">measured vs simulated</span>
          <button type="button" className="view-link rp-table-toggle" aria-expanded={table} aria-controls={tableId} onClick={() => setTable((open) => !open)}>
            {table ? "Hide table" : "View as table"}
          </button>
        </div>
        {hasChart ? (
          <>
            <ReplayChart chart={chart} model={vm.model} />
            <ul className="rp-legend" aria-label="Chart key">
              <li>
                <span className="rp-swatch rp-swatch--measured" aria-hidden="true" />
                measured, solid line
              </li>
              <li>
                <span className="rp-swatch rp-swatch--simulated" aria-hidden="true" />
                simulated, dashed line
              </li>
              <li>
                <span className="rp-swatch rp-swatch--gap" aria-hidden="true" />
                not replayed
              </li>
            </ul>
          </>
        ) : (
          <div className="rp-empty">
            <b>No simulated cost.</b> {`${vm.pricingText}. The simulated cost is Unknown, not 0, so there is no chart to draw.`}
          </div>
        )}
        <div id={tableId}>{table && <TurnTable turns={vm.turns} />}</div>
      </section>

      {vm.coverage.partial && <NotReplayed vm={vm} />}
      {vm.coverage.subagentRunsText !== undefined && <p className="rp-basis text-muted">{vm.coverage.subagentRunsText}</p>}
      <Assumptions vm={vm} />
      <p className="rp-basis text-muted">{`Simulated: assumes the same conversation and token counts, ${vm.pricingText}. It is not what was billed.`}</p>
    </ViewShell>
  );
}
