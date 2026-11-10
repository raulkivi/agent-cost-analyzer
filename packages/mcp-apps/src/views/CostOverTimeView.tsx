// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Currency } from "@agent-cost-analyzer/domain";
import { SegmentedControl } from "@agent-cost-analyzer/web/ui/SegmentedControl";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ViewBrand } from "../brand/view-brand.js";
import type { AppHostPort, ToolResult } from "../host/app-host-port.js";
import type { ClipboardPort } from "../host/clipboard-port.js";
import { toCostSeriesViewModel } from "../view-models/index.js";
import type { CostSeriesViewModel } from "../view-models/index.js";
import { ErrorBox } from "./SessionCostView.js";
import { ViewShell } from "./ViewShell.js";
import { BasisTiles } from "./cost-over-time/BasisTiles.js";
import { CostChart } from "./cost-over-time/CostChart.js";
import { PriceChangeList } from "./cost-over-time/PriceChangeList.js";
import { ProjectSessions } from "./cost-over-time/ProjectSessions.js";
import type { SessionRef } from "./cost-over-time/ProjectSessions.js";
import { TokensByType } from "./cost-over-time/TokensByType.js";
import { VendorBreakdown } from "./cost-over-time/VendorBreakdown.js";
import { buildChart, unitLabelOf } from "./cost-over-time/chart-model.js";
import { explainError } from "./cost-over-time/explain-error.js";
import { parseCostSeries } from "./cost-over-time/parse-cost-series.js";
import { DrillDown } from "./cost-rollup/DrillDown.js";
import "./cost-over-time/cost-over-time.css";

// U9, cost over time for a repository or a project (plan §4.5, board
// CostOverTime.dc.html). Renders get_repository_cost and get_project_cost.
// A top session of a project calls get_session_cost through the port and swaps
// to U1 in place; this view stays mounted, so Back refetches nothing and the
// currency choice survives. Session titles are logged text: shown in the
// table, never sent to the host's model (§6).

// Set when another view opens this one in place (U10): its kicker comes
// first, the back control sits above the title, and the trail names the path
// for a session opened from here. The lead is told whether it may take focus:
// it may not while this view puts focus back on a session row it returns to.
export interface CostOverTimeFrame {
  kicker: string;
  lead: (takeFocus: boolean) => ReactNode;
  trail: string[];
}

const FALLBACK_KICKER = "Cost over time";

const UNIT_OPTIONS: Record<Currency, string> = { AI_CREDITS: "AI Credits", USD: "USD" };

function Shell({ brand, kicker, title, meta, children }: { brand: ViewBrand; kicker: string; title: string; meta?: string; children?: ReactNode }) {
  return (
    <ViewShell brand={brand} kicker={kicker} title={title} meta={meta}>
      {children}
    </ViewShell>
  );
}

// The tool answered with an error: say why, in plain text, in place of a chart.
function ErrorState({ brand, errorText }: { brand: ViewBrand; errorText: string | undefined }) {
  const explained = explainError(errorText);
  if (explained.kind === "no-projects") {
    return (
      <Shell brand={brand} kicker="Project cost" title="No projects here" meta="project cost and project comparisons">
        <div className="ct-state">
          <p>{explained.reason}</p>
          <h2>What to ask instead</h2>
          <p>Cost by repository works as usual: ask for a repository&apos;s cost, or compare repositories.</p>
          <p className="text-muted">
            The tool answered <code>{explained.answer}</code>. The view shows the reason above in place of a chart.
          </p>
        </div>
      </Shell>
    );
  }
  return (
    <Shell brand={brand} kicker={FALLBACK_KICKER} title="Cost over time">
      <ErrorBox title="Couldn't load the cost over time.">
        {explained.text === undefined ? "The tool returned an error. The text answer above is complete." : `The tool returned an error: ${explained.text}`}
      </ErrorBox>
    </Shell>
  );
}

function bucketNotes(vm: CostSeriesViewModel, partial: number): string[] {
  const noun = vm.bucket;
  const notes: string[] = [];
  if (partial > 0) notes.push(`${partial} ${noun}${partial === 1 ? " is" : "s are"} partly known, so ${partial === 1 ? "its bar is" : "their bars are"} a floor.`);
  if (vm.undatedNote !== undefined) notes.push(`${vm.undatedNote[0]!.toUpperCase()}${vm.undatedNote.slice(1)}.`);
  return notes;
}

export function CostOverTimeView({
  port,
  brand,
  clipboard,
  result,
  frame,
}: {
  port: AppHostPort;
  brand: ViewBrand;
  clipboard?: ClipboardPort | undefined;
  result: ToolResult | undefined;
  frame?: CostOverTimeFrame | undefined;
}) {
  const cost = useMemo(() => (result === undefined || result.isError ? undefined : parseCostSeries(result.structuredContent)), [result]);
  const vm = useMemo(() => (cost === undefined ? undefined : toCostSeriesViewModel(cost)), [cost]);
  const [chosen, setChosen] = useState<Currency | undefined>();
  const [selected, setSelected] = useState<SessionRef | undefined>();
  // The session last opened, so Back can return focus to its row.
  const [returnTo, setReturnTo] = useState<SessionRef | undefined>();

  if (result === undefined) {
    return (
      <Shell brand={brand} kicker={FALLBACK_KICKER} title="Cost over time">
        <p role="status" className="text-muted">
          Waiting for the cost over time…
        </p>
      </Shell>
    );
  }
  if (result.isError) return <ErrorState brand={brand} errorText={result.errorText} />;
  if (vm === undefined) {
    return (
      <Shell brand={brand} kicker={FALLBACK_KICKER} title="Cost over time">
        <ErrorBox title="Couldn't load the cost over time.">The result is one this view can&apos;t read. The text answer above is complete.</ErrorBox>
      </Shell>
    );
  }

  const ownKicker = vm.kind === "project" ? "Project cost" : "Repository cost";
  const kicker = frame === undefined ? ownKicker : `${frame.kicker} › ${ownKicker}`;
  if (selected !== undefined) {
    return (
      <DrillDown
        port={port}
        brand={brand}
        clipboard={clipboard}
        session={selected}
        onBack={() => setSelected(undefined)}
        origin={
          frame === undefined
            ? { kicker: `${kicker} › Session cost`, backLabel: "Back to cost over time", parent: "cost over time" }
            : { kicker: `${kicker} › Session cost`, backLabel: `Back to ${vm.title}`, parent: vm.title, trail: frame.trail }
        }
      />
    );
  }

  const { currencies } = vm.chart;
  const currency: Currency | null = chosen !== undefined && currencies.includes(chosen) ? chosen : (currencies[0] ?? null);
  const chart = buildChart(vm.chart.points, currency, vm.markers);
  const partial = chart.bars.filter((bar) => bar.state === "partial").length;
  const noun = vm.bucket;
  const heading = `Cost per ${noun}`;
  const basisLine = vm.basisTiles[0]?.basisNote;
  const meta = [vm.kind, vm.periodText, vm.bucketText, vm.pricingText].filter((part) => part !== undefined).join(" · ");
  const unit = unitLabelOf(currency);
  const notes = bucketNotes(vm, partial);

  return (
    <ViewShell brand={brand} kicker={kicker} title={vm.title} meta={meta} lead={frame?.lead(returnTo === undefined)}>
      <BasisTiles tiles={vm.basisTiles} />
      <p className="ct-basis text-muted">
        {`${vm.sessionsText}, ${vm.turnsText}. Preferred basis takes billed, then reported, then priced${basisLine === undefined ? "" : `: ${basisLine}`}.`}
        {currencies.length > 1 ? " Currencies are never added together." : ""}
      </p>
      {vm.providerIssues.length > 0 && (
        <ul className="ct-issues" aria-label="Logs not fully read">
          {vm.providerIssues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}

      <section className="view-section" aria-label={heading}>
        <div className="ct-chart-head">
          <div className="view-section-head">
            <h2>{heading}</h2>
            <span className="text-muted">{`${vm.basis === "preferred" ? "preferred" : vm.basis} basis · ${unit}`}</span>
          </div>
          {currencies.length > 1 && (
            <fieldset className="ct-currency">
              <legend className="sr-only">Currency</legend>
              <SegmentedControl
                name="cost-currency"
                options={currencies.map((value) => ({ value, label: UNIT_OPTIONS[value] }))}
                value={currency ?? currencies[0]!}
                onChange={setChosen}
              />
            </fieldset>
          )}
        </div>
        <CostChart chart={chart} currency={currency} heading={heading} noun={noun} />
        <ul className="ct-legend" aria-label="Chart key">
          <li>
            <span className="ct-swatch ct-swatch-bar" aria-hidden="true" />
            {`cost, ${vm.basis} basis`}
          </li>
          <li>
            <span className="ct-swatch ct-swatch-partial" aria-hidden="true" />
            partly known
          </li>
          <li>
            <span className="ct-swatch ct-swatch-line" aria-hidden="true" />
            documented price change
          </li>
          <li>
            <span className="ct-swatch ct-swatch-line ct-swatch-line-inferred" aria-hidden="true" />
            observed price change, inferred
          </li>
        </ul>
        {notes.map((note) => (
          <p key={note} className="ct-basis text-muted">
            {note}
          </p>
        ))}
      </section>

      {vm.markers.length > 0 && (
        <section className="view-section" aria-label="Price changes">
          <div className="view-section-head">
            <h2>Price changes in this range</h2>
            <span className="text-muted">for the models priced</span>
          </div>
          <PriceChangeList markers={vm.markers} />
        </section>
      )}

      {vm.project !== undefined && (
        <>
          <section className="view-section" aria-label="Cost by vendor">
            <div className="view-section-head">
              <h2>Cost by vendor, then model</h2>
              <span className="text-muted">{`${unit}, ${vm.basis} basis`}</span>
            </div>
            <VendorBreakdown vendors={vm.byVendor} currency={currency} />
          </section>
          <section className="view-section" aria-label="Tokens by type">
            <div className="view-section-head">
              <h2>Tokens by type</h2>
              <span className="text-muted">per model</span>
            </div>
            <TokensByType rows={vm.project.byTokenType} />
          </section>
          <section className="view-section" aria-label="Top sessions">
            <div className="view-section-head">
              <h2>Top sessions</h2>
              <span className="text-muted">{`${unit}, ${vm.basis} basis · click a session to open it here`}</span>
            </div>
            <ProjectSessions
              sessions={vm.project.topSessions}
              currency={currency}
              focusOnMount={returnTo}
              onOpen={(session) => {
                setSelected(session);
                setReturnTo(session);
              }}
            />
          </section>
        </>
      )}

      {vm.conversionNote !== undefined && <p className="ct-basis text-muted">{vm.conversionNote}</p>}
    </ViewShell>
  );
}
