// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { StatTile } from "@agent-cost-analyzer/web/ui/StatTile";
import { useMemo } from "react";
import type { ViewBrand } from "../brand/view-brand.js";
import type { AppHostPort, ToolResult } from "../host/app-host-port.js";
import { pluralize } from "../view-models/format.js";
import { toCostVarianceViewModel } from "../view-models/index.js";
import type { CostVarianceViewModel, CurrencyBlock } from "../view-models/index.js";
import { ErrorBox } from "./SessionCostView.js";
import { ViewShell } from "./ViewShell.js";
import { CostChangeWaterfall } from "./cost-change/CostChangeWaterfall.js";
import { ModelTable } from "./cost-change/ModelTable.js";
import { NotExplained } from "./cost-change/NotExplained.js";
import { PriceChanges } from "./cost-change/PriceChanges.js";
import { parseCostVariance } from "./cost-change/parse-variance.js";
import "./cost-change/cost-change.css";

// U11, why did the cost change (plan §4.5, board CostChange.dc.html).
// Renders the explain_cost_change result. Everything is in the result, so
// the view calls no tool: rows open locally. (The "Price changes" control is
// drawn disabled until U13, A28.) Reasons and subject names are logged text:
// displayed, never sent to the host's model (§6).

const KICKER = "Cost change";
const UNIT: Record<CurrencyBlock["currency"], string> = { AI_CREDITS: "AI Credits", USD: "USD" };

function Tiles({ vm, block, notExplainedTile }: { vm: CostVarianceViewModel; block: CurrencyBlock; notExplainedTile: boolean }) {
  const [start, , , , end] = block.steps;
  return (
    <div className="stat-tiles view-tiles">
      <StatTile label={`${vm.periodA.label} (A)`} value={start?.text ?? ""} note={`priced, ${vm.pricingText}`} />
      <StatTile label={`${vm.periodB.label} (B)`} value={end?.text ?? ""} note={`priced, ${vm.pricingText}`} />
      <StatTile label="Change" value={block.changeAmountText} note={block.changePercentText} />
      {notExplainedTile && <StatTile label="Not explained" value={pluralize(vm.notExplained.periodA.turns + vm.notExplained.periodB.turns, "turn")} note="no price for these turns; not counted as 0" />}
    </div>
  );
}

function Block({ vm, block, withHeading, notExplainedTile }: { vm: CostVarianceViewModel; block: CurrencyBlock; withHeading: boolean; notExplainedTile: boolean }) {
  const unit = UNIT[block.currency];
  return (
    <section className="cv-block" aria-label={`Cost change in ${unit}`}>
      <h2 className={withHeading ? undefined : "sr-only"}>{unit}</h2>
      <Tiles vm={vm} block={block} notExplainedTile={notExplainedTile} />
      <div className="cv-sub">
        <h3>What moved the cost</h3>
        {block.noEarlierFigure ? (
          <p className="cv-note">
            {`${vm.periodA.label} has no priced figure, so there is no change to break down: no earlier figure. ${vm.periodB.label} came to ${block.steps[4]?.text ?? ""}.`}
          </p>
        ) : (
          <>
            <CostChangeWaterfall block={block} ariaLabel={`Waterfall from ${vm.periodA.label} to ${vm.periodB.label}, ${unit}`} />
            <p className="cv-note text-muted">
              Usage: B's tokens at A's average price, before any change of model. Price: B's tokens times the change in unit price. Mix: work that moved between models. The three add up to the change.
            </p>
          </>
        )}
      </div>
      <div className="cv-sub">
        <h3>By model</h3>
        <ModelTable block={block} periodA={vm.periodA} periodB={vm.periodB} />
      </div>
    </section>
  );
}

export function CostChangeView({ brand, result }: { port: AppHostPort; brand: ViewBrand; result: ToolResult | undefined }) {
  const variance = useMemo(() => (result === undefined || result.isError ? undefined : parseCostVariance(result.structuredContent)), [result]);
  const vm = useMemo(() => (variance === undefined ? undefined : toCostVarianceViewModel(variance)), [variance]);

  if (result === undefined) {
    return (
      <ViewShell brand={brand} kicker={KICKER} title="Cost change">
        <p role="status" className="text-muted">
          Waiting for the cost change…
        </p>
      </ViewShell>
    );
  }
  if (vm === undefined) {
    // The tool's own text, when the host gave one, is rendered as a text node only.
    const reason = result.isError ? result.errorText?.trim() : undefined;
    return (
      <ViewShell brand={brand} kicker={KICKER} title="Cost change">
        <ErrorBox title="Couldn't explain the change.">
          {reason ? `The tool returned an error: ${reason}` : "explain_cost_change returned an error or a result this view can't read. The text answer above has the reason; ask again with a month such as 2026-10."}
        </ErrorBox>
      </ViewShell>
    );
  }

  const meta = `${vm.groupBy} · ${vm.periodA.label} vs ${vm.periodB.label} · priced, ${vm.pricingText}`;
  return (
    <ViewShell brand={brand} kicker={KICKER} title={vm.title} meta={meta}>
      <p className="cv-note text-muted">This view always uses the priced basis: tokens times the price version in force when each turn ran. Billed and reported figures are not used here.</p>
      {vm.providerIssues.length > 0 && (
        <ul className="cv-note" aria-label="Providers not fully read">
          {vm.providerIssues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      {vm.currencies.length === 0 && <p className="text-muted">No priced figures in either period.</p>}
      {vm.currencies.map((block, index) => (
        <Block key={block.currency} vm={vm} block={block} withHeading={vm.currencies.length > 1} notExplainedTile={index === 0} />
      ))}
      <NotExplained vm={vm} />
      <PriceChanges vm={vm} />
      {vm.conversionNote !== undefined && <p className="cv-note text-muted">{vm.conversionNote}</p>}
    </ViewShell>
  );
}
