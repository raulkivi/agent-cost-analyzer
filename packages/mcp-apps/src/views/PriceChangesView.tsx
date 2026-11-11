// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useMemo } from "react";
import type { ReactNode } from "react";
import type { ViewBrand } from "../brand/view-brand.js";
import type { AppHostPort, ToolResult } from "../host/app-host-port.js";
import { pluralize } from "../view-models/format.js";
import { toPriceChangesViewModel } from "../view-models/index.js";
import type { PriceChangesViewModel } from "../view-models/index.js";
import { ErrorBox } from "./SessionCostView.js";
import { ViewShell } from "./ViewShell.js";
import { DocumentedEntry, ObservedEntry } from "./price-changes/ChangeEntry.js";
import { PriceTimeline } from "./price-changes/PriceTimeline.js";
import { parsePriceChanges } from "./price-changes/parse-price-changes.js";
import { timelineEntries } from "./price-changes/timeline-model.js";
import "./price-changes/price-changes.css";

// U13, when did prices change (plan §4.5, board Increment3States.dc.html).
// Renders the get_price_changes result and calls no tool: it has no
// drill-down. Documented changes (price book, with sources) and observed ones
// (inferred from billed against priced) share the oldest-first timeline but
// stay apart by tag, diamond, rail and the weekly table. Opened from U11,
// the parent passes a `frame` (kicker, Back control) and the models U11
// filtered to; the result is then already the whole range and this view shows
// those models only. Model, channel, source and note text is displayed, never
// sent to the host's model (§6).

const KICKER = "Price changes";

export interface PriceChangesFrame {
  kicker: string; // "Cost change › Price changes"
  lead: ReactNode; // the Back control
  models: readonly string[]; // U11's models with the largest price effect
}

function countsText(vm: PriceChangesViewModel): string {
  const parts = [`${pluralize(vm.documented.length + vm.observed.length, "change")}`];
  if (vm.documented.length > 0) parts.push(`${vm.documented.length} documented`);
  if (vm.observed.length > 0) parts.push(`${vm.observed.length} inferred`);
  return parts.length === 1 ? parts[0]! : `${parts[0]} · ${parts.slice(1).join(", ")}`;
}

function Issues({ issues }: { issues: readonly string[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="pc-issues" aria-label="Providers not fully read">
      {issues.map((issue) => (
        <li key={issue}>{issue}</li>
      ))}
    </ul>
  );
}

export function PriceChangesView({ brand, result, frame }: { port?: AppHostPort; brand: ViewBrand; result: ToolResult | undefined; frame?: PriceChangesFrame }) {
  const list = useMemo(() => (result === undefined || result.isError ? undefined : parsePriceChanges(result.structuredContent)), [result]);
  const models = frame?.models;
  const vm = useMemo(() => (list === undefined ? undefined : toPriceChangesViewModel(list, models === undefined ? {} : { models })), [list, models]);
  const kicker = frame?.kicker ?? KICKER;
  const lead = frame?.lead;

  if (result === undefined) {
    return (
      <ViewShell brand={brand} kicker={kicker} title="Price changes" lead={lead}>
        <p role="status" className="text-muted">
          Waiting for the price changes…
        </p>
      </ViewShell>
    );
  }
  if (vm === undefined) {
    const reason = result.isError ? result.errorText?.trim() : undefined;
    return (
      <ViewShell brand={brand} kicker={kicker} title="Price changes" lead={lead}>
        <ErrorBox title="Couldn't load the price changes.">
          {reason ? `The tool returned an error: ${reason.slice(0, 500)}` : "get_price_changes returned an error or a result this view can't read. The text answer above has the reason; ask again with a date range such as 2026-10-01 to 2026-10-31."}
        </ErrorBox>
      </ViewShell>
    );
  }

  const title = frame === undefined ? (vm.periodText === undefined ? "Price changes" : `Price changes, ${vm.periodText}`) : "Price changes behind the cost change";
  const meta = frame === undefined ? `oldest first · ${countsText(vm)}` : `${vm.periodText === undefined ? "" : `${vm.periodText} · `}oldest first · ${countsText(vm)}`;

  if (vm.empty) {
    return (
      <ViewShell brand={brand} kicker={kicker} title={title} lead={lead}>
        {vm.filter !== undefined && <p className="pc-note text-muted">{vm.filter.text}</p>}
        <Issues issues={vm.issues} />
        <div className="pc-state">
          <p>{vm.emptyText}</p>
          <p className="text-muted">{frame === undefined ? "Ask for a wider period, or for one model's changes." : "Go back to the cost change; its documented price changes list the ones between its two periods."}</p>
        </div>
      </ViewShell>
    );
  }

  const entries = timelineEntries(vm);
  return (
    <ViewShell brand={brand} kicker={kicker} title={title} meta={meta} lead={lead}>
      {vm.filter !== undefined && <p className="pc-note">{vm.filter.text}</p>}
      <Issues issues={vm.issues} />
      <section className="view-section" aria-label="Price change timeline">
        <PriceTimeline vm={vm} />
      </section>
      <section className="view-section" aria-label="Price changes, oldest first">
        <h2 className="sr-only">Price changes, oldest first</h2>
        <ol className="pc-list">
          {entries.map(({ key, change }) => (change.kind === "documented" ? <DocumentedEntry key={key} change={change} /> : <ObservedEntry key={key} change={change} note={vm.observedNote} />))}
        </ol>
      </section>
    </ViewShell>
  );
}
