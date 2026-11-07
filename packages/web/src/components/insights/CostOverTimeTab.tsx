// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useCallback, useMemo, useState } from "react";
import type { CostBasisChoice, CostSeries } from "@agent-cost-analyzer/domain";
import { isAbortError } from "../../api-client/abort.js";
import { fetchCostTimeSeries, type CostSeriesQuery } from "../../api-client/cost-analysis.js";
import { costChartTable, CostTimeChart } from "../../charts/CostTimeChart.js";
import { ViewAsTable } from "../../charts/ViewAsTable.js";
import { conversionNote, coverageNote, coverageRatio, formatAmount, formatChange, formatPercent, formatTick, unitLabel } from "../../lib/cost/cost-format.js";
import { seriesScope, type ScopePlaceholders } from "../../lib/cost/cost-scope.js";
import { previousRange, rangeFor } from "../../lib/cost/date-ranges.js";
import { SeriesPalette } from "../../lib/cost/series-colors.js";
import { chartLines, costKpis, groupPriceMarkers, nativeCurrencies, runningTotalLine, type ChartLine } from "../../lib/cost/series-model.js";
import { useCancellableLoad } from "../../lib/use-cancellable-load.js";
import { AsyncView, cancelledEmptyState } from "../ui/AsyncView.js";
import { Blueprint } from "../ui/Blueprint.js";
import { SegmentedControl } from "../ui/SegmentedControl.js";
import { StatTile } from "../ui/StatTile.js";
import { BUCKET_ADVERB, CostFilters, costKicker, PRICING_LABEL, type CostFilterState } from "./CostFilters.js";

// Phase 15 step 15.9 (plan §11.1, §11.2; board 1, Main.dc.html): the
// Dashboard's Cost over time tab over GET /api/cost/timeseries. It follows
// the list boxes' Project, Repository and Provider selections (cost-scope.ts)
// and names any other selection it can't apply. One series: columns plus a
// separate running total; two to four: lines with direct labels; five or
// more: small multiples on a shared or own scale. KPI tiles carry coverage;
// unknown cost is a gap, never 0.

type Selections = Readonly<Record<string, readonly string[]>>;

export interface CostOrders {
  // Project ids in projects-file order; repository keys (redacted, as the
  // API returns them) in sorted order. A series' colour is its position.
  project: string[];
  repository: string[];
}

interface CostOverTimeTabProps {
  selections: Selections;
  fieldLabel: (fieldId: string) => string;
  orders: CostOrders;
  placeholders: ScopePlaceholders;
  basis: CostBasisChoice;
  now: Date;
  loadSeries?: (query: CostSeriesQuery, signal: AbortSignal) => Promise<CostSeries>;
}

interface Loaded {
  series: CostSeries;
  // The same scope by day from the previous period's start, for the KPIs.
  summary?: CostSeries;
}

const MAX_LINES = 4;
const SCALES = [
  { value: "shared", label: "Shared scale" },
  { value: "own", label: "Own scale" },
] as const;

export function ignoredNote(ignored: readonly string[], fieldLabel: (fieldId: string) => string): string | undefined {
  if (ignored.length === 0) return undefined;
  return `Not applied here: ${ignored.map(fieldLabel).join(", ")}. This tab follows the Project, Repository and one Provider selection.`;
}

export function CostOverTimeTab({ selections, fieldLabel, orders, placeholders, basis, now, loadSeries = fetchCostTimeSeries }: CostOverTimeTabProps) {
  const [filters, setFilters] = useState<CostFilterState>({ preset: "last-90-days", bucket: "week", unit: "AI_CREDITS", pricing: "as-of-use" });
  const [scale, setScale] = useState<"shared" | "own">("shared");
  const scope = useMemo(() => seriesScope(selections, placeholders), [selections, placeholders]);
  const range = useMemo(() => rangeFor(filters.preset, now), [filters.preset, now]);
  const { bucket, pricing, unit } = filters;

  const load = useCallback(
    async (signal: AbortSignal): Promise<Loaded> => {
      const view = {
        basis,
        pricing,
        groupBy: scope.groupBy,
        ...(scope.ids ? { ids: scope.ids } : {}),
        ...(scope.providerId ? { provider: scope.providerId } : {}),
      };
      const previous = previousRange(range);
      const [series, summary] = await Promise.all([
        loadSeries({ since: range.since, until: range.until, bucket, ...view }, signal),
        loadSeries({ since: previous.since, until: range.until, bucket: "day", ...view }, signal).catch((error: unknown) => {
          if (isAbortError(error)) throw error;
          return undefined;
        }),
      ]);
      return { series, summary };
    },
    [basis, pricing, scope, range, bucket, loadSeries],
  );
  const { state, cancel, retry } = useCancellableLoad(load);

  const palette = useMemo(() => new SeriesPalette(scope.groupBy === "project" ? orders.project : orders.repository), [scope.groupBy, orders]);
  const lineOptions = { palette, unit, scope };
  const lines = state.kind === "ready" ? chartLines(state.data.series, lineOptions) : [];
  const kpis = state.kind === "ready" ? costKpis(lines, state.data.summary, range, lineOptions) : undefined;
  const turns = kpis?.coverage.turns ?? 0;
  const note = ignoredNote(scope.ignored, fieldLabel);

  return (
    <div className="cost-tab">
      <CostFilters name="cost-time" label="Chart filters" state={filters} onChange={setFilters} />
      {note && <p className="text-muted cost-note">{note}</p>}
      <AsyncView
        status={state.kind === "ready" ? (turns === 0 ? "empty" : "ready") : state.kind === "cancelled" ? "empty" : state.kind}
        loadingText="Loading cost over time…"
        readyText="Cost over time loaded."
        skeleton="panel"
        onCancel={cancel}
        error={state.kind === "error" ? { title: `Could not load cost over time: ${state.message}`, onRetry: retry } : undefined}
        empty={
          state.kind === "cancelled"
            ? cancelledEmptyState(retry)
            : {
                title: "No turns in this range for this selection.",
                body: "Turns are counted by their own date (UTC). Try a longer range, or clear a selection.",
                action: filters.preset === "this-year" ? undefined : { label: "Show this year", onClick: () => setFilters({ ...filters, preset: "this-year" }) },
              }
        }
        partial={
          kpis && kpis.coverage.knownTurns < kpis.coverage.turns
            ? `Some turns have no known cost: ${coverageNote(kpis.coverage)}. Totals cover only those turns; unknown cost is never counted as 0.`
            : undefined
        }
      >
        {state.kind === "ready" && kpis && (
          <>
            <div className="cost-kpis">
              <StatTile label="Total cost" value={withUnit(formatAmount(kpis.total, unit), unit)} note={coverageNote(kpis.coverage)} />
              <StatTile
                label="Change vs previous period"
                value={formatChange(kpis.change)}
                note={kpis.previous === null ? "previous period: unknown" : `previous period: ${withUnit(formatAmount(kpis.previous, unit), unit)}`}
              />
              <StatTile
                label="Cost per active day"
                value={withUnit(formatAmount(kpis.perActiveDay, unit), unit)}
                note={kpis.activeDays === null ? undefined : `${kpis.activeDays} active ${kpis.activeDays === 1 ? "day" : "days"}`}
              />
              <StatTile label="Coverage" value={formatPercent(coverageRatio(kpis.coverage), 0)} note={coverageNote(kpis.coverage)} />
            </div>
            <CostChartCard
              series={state.data.series}
              lines={lines}
              groupBy={scope.groupBy}
              filters={filters}
              basis={basis}
              scale={scale}
              onScale={setScale}
            />
          </>
        )}
      </AsyncView>
    </div>
  );
}

function withUnit(text: string, unit: CostFilterState["unit"]): string {
  return unit === "AI_CREDITS" && text !== "unknown" ? `${text} AI Credits` : text;
}

function chartTitle(lines: readonly ChartLine[], groupBy: "project" | "repository"): string {
  if (lines.length === 1) return lines[0]!.label;
  return `${lines.length} ${groupBy === "project" ? "projects" : "repositories"}`;
}

interface CostChartCardProps {
  series: CostSeries;
  lines: ChartLine[];
  groupBy: "project" | "repository";
  filters: CostFilterState;
  basis: CostBasisChoice;
  scale: "shared" | "own";
  onScale: (scale: "shared" | "own") => void;
}

function CostChartCard({ series, lines, groupBy, filters, basis, scale, onScale }: CostChartCardProps) {
  const { unit, bucket } = filters;
  const format = (value: number) => formatAmount(value, unit);
  const tick = (value: number) => formatTick(value, unit);
  const markers = groupPriceMarkers(series.priceChanges);
  const title = chartTitle(lines, groupBy);
  const ariaLabel = `Cost over time, ${title}, ${BUCKET_ADVERB[bucket]}, ${unitLabel(unit)}`;
  const kicker = costKicker(["Cost over time", BUCKET_ADVERB[bucket], unitLabel(unit), PRICING_LABEL[filters.pricing], `${basis} basis`]);
  const conversion = conversionNote(nativeCurrencies(lines), unit);
  const many = lines.length > MAX_LINES;
  const shared = Math.max(0, ...lines.flatMap((line) => line.points.map((point) => point.value ?? 0)));

  return (
    <Blueprint className="audit-section">
      <figure className="cost-figure">
        <div className="cost-figure-head">
          <div>
            <div className="card-kicker">{kicker}</div>
            <h4 className="cost-chart-title">{title}</h4>
          </div>
          {many && (
            <div role="radiogroup" aria-label="Y scale">
              <SegmentedControl name="cost-time-scale" options={SCALES} value={scale} onChange={onScale} />
            </div>
          )}
        </div>
        {lines.length === 1 ? (
          <>
            <CostTimeChart ariaLabel={ariaLabel} lines={lines} bucket={bucket} format={format} formatTick={tick} unitLabel={unitLabel(unit)} markers={markers} mode="columns" />
            <div className="cost-running-total">
              <div className="card-kicker">Running total {"·"} a separate chart, never a second axis</div>
              <CostTimeChart
                ariaLabel={`Running total of known cost, ${title}, ${unitLabel(unit)}`}
                lines={[runningTotalLine(lines[0]!)]}
                bucket={bucket}
                format={format}
                formatTick={tick}
                unitLabel={unitLabel(unit)}
                directLabels
              />
            </div>
          </>
        ) : many ? (
          <ViewAsTable table={costChartTable({ ariaLabel, lines, bucket, format, unitLabel: unitLabel(unit), markers })}>
            <div className="cost-small-multiples">
              {lines.map((line) => (
                <section key={line.key ?? "none"} role="region" aria-label={`Small multiple: ${line.label}`} className="cost-small-multiple">
                  <h5 className="cost-small-multiple-title">
                    <span className="chart-legend-swatch" style={{ background: line.style.color }} aria-hidden="true" />
                    <span className="truncate">{line.label}</span>
                    <span className="text-muted cost-small-multiple-total">{format(line.total ?? 0)}</span>
                  </h5>
                  <CostTimeChart
                    ariaLabel={`${line.label}, ${BUCKET_ADVERB[bucket]}, ${unitLabel(unit)}`}
                    lines={[line]}
                    bucket={bucket}
                    format={format}
                    formatTick={tick}
                    unitLabel={unitLabel(unit)}
                    markers={markers}
                    yMax={scale === "shared" ? shared : undefined}
                    compact
                  />
                </section>
              ))}
            </div>
          </ViewAsTable>
        ) : (
          <CostTimeChart ariaLabel={ariaLabel} lines={lines} bucket={bucket} format={format} formatTick={tick} unitLabel={unitLabel(unit)} markers={markers} />
        )}
        <p className="text-muted cost-footnote">
          {[
            conversion,
            "A period whose turns have no known cost is a gap, never 0.",
            series.undatedTurns > 0 ? `${series.undatedTurns} turns have no date and are in no period.` : undefined,
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      </figure>
    </Blueprint>
  );
}
