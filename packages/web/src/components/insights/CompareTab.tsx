import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  repositoryFolderLabel,
  type ComparePeriod,
  type CostBasisChoice,
  type CostCompareGroupBy,
  type CostComparison,
  type CostComparisonRow,
  type CostSeries,
} from "@agent-cost-analyzer/domain";
import { fetchCostComparison, fetchCostTimeSeries, type CostCompareQuery, type CostSeriesQuery } from "../../api-client/cost-analysis.js";
import { CostTimeChart } from "../../charts/CostTimeChart.js";
import { HorizontalBars } from "../../charts/HorizontalBars.js";
import { coverageNote, coverageRatio, formatAmount, formatChange, formatPercent, unitLabel, usdIn, type DisplayUnit } from "../../lib/cost/cost-format.js";
import { compareScope, type ScopePlaceholders } from "../../lib/cost/cost-scope.js";
import { compareBucketFor, rangeFor } from "../../lib/cost/date-ranges.js";
import { SeriesPalette } from "../../lib/cost/series-colors.js";
import { chartLines, indexedLines } from "../../lib/cost/series-model.js";
import { useCancellableLoad } from "../../lib/use-cancellable-load.js";
import { AsyncView, cancelledEmptyState } from "../ui/AsyncView.js";
import { Blueprint } from "../ui/Blueprint.js";
import { Drawer } from "../ui/Drawer.js";
import { SegmentedControl } from "../ui/SegmentedControl.js";
import { CostFilters, costKicker, PRICING_LABEL, type CostFilterState } from "./CostFilters.js";
import { ignoredNote, type CostOrders } from "./CostOverTimeTab.js";

// Phase 15 step 15.9 (plan §8.2, §11.3; boards 2a and 2b): the Dashboard's
// Compare tab over GET /api/cost/compare. The table comes first, with the
// §8.2 measures and units in the headers; below 700 px only the priority
// columns stay (name, total, change, coverage), the rest are in each row's
// Details drawer, and Columns keeps others. Then an indexed line chart
// (first period = 100, one axis) and share-of-total bars, each with "View as
// table". Figures are asked for in USD and shown in the picked unit at
// 1 AI Credit = $0.01 (D2).

type Selections = Readonly<Record<string, readonly string[]>>;

type ColumnId = "total" | "change" | "perSession" | "perActiveDay" | "share" | "cacheHit" | "outputShare" | "coverage";

interface Column {
  id: ColumnId;
  header: (unit: DisplayUnit) => string;
  cell: (row: CostComparisonRow, unit: DisplayUnit) => string;
}

const firstUsd = (amounts: readonly { currency: string; amount: number }[]): number | null => amounts.find((amount) => amount.currency === "USD")?.amount ?? null;
const unitHeader = (label: string) => (unit: DisplayUnit) => `${label} (${unitLabel(unit)})`;
const changeRatio = (row: CostComparisonRow) => row.change.find((change) => change.currency === "USD")?.ratio ?? null;

const COLUMNS: readonly Column[] = [
  { id: "total", header: unitHeader("Total"), cell: (row, unit) => formatAmount(usdIn(row.total.usd, unit), unit) },
  { id: "change", header: () => "Change", cell: (row) => formatChange(changeRatio(row)) },
  { id: "perSession", header: unitHeader("Per session"), cell: (row, unit) => formatAmount(usdIn(firstUsd(row.perSession), unit), unit) },
  { id: "perActiveDay", header: unitHeader("Per active day"), cell: (row, unit) => formatAmount(usdIn(firstUsd(row.perActiveDay), unit), unit) },
  { id: "share", header: () => "Share", cell: (row) => formatPercent(row.share.find((share) => share.currency === "USD")?.share ?? null) },
  { id: "cacheHit", header: () => "Cache-hit ratio", cell: (row) => formatPercent(row.cacheHitRatio) },
  { id: "outputShare", header: () => "Output share", cell: (row) => formatPercent(row.outputShare) },
  { id: "coverage", header: () => "Coverage", cell: (row) => formatPercent(coverageRatio(row.coverage.preferred), 0) },
];

const PRIORITY: readonly ColumnId[] = ["total", "change", "coverage"];

const GROUP_BY = [
  { value: "project", label: "Project" },
  { value: "repository", label: "Repository" },
] as const;

const COMPARE_WITH: readonly { value: ComparePeriod; label: string }[] = [
  { value: "previous", label: "Previous period" },
  { value: "last-year", label: "Same dates last year" },
];

interface CompareTabProps {
  selections: Selections;
  // The grouping fields' values still possible under the whole selection.
  possible: { project: string[]; repository: string[] };
  fieldLabel: (fieldId: string) => string;
  orders: CostOrders;
  placeholders: ScopePlaceholders;
  basis: CostBasisChoice;
  now: Date;
  narrow?: boolean;
  loadComparison?: (query: CostCompareQuery, signal: AbortSignal) => Promise<CostComparison>;
  loadSeries?: (query: CostSeriesQuery, signal: AbortSignal) => Promise<CostSeries>;
}

interface Loaded {
  comparison: CostComparison;
  series: CostSeries;
}

export function CompareTab({
  selections,
  possible,
  fieldLabel,
  orders,
  placeholders,
  basis,
  now,
  narrow = false,
  loadComparison = fetchCostComparison,
  loadSeries = fetchCostTimeSeries,
}: CompareTabProps) {
  const [filters, setFilters] = useState<CostFilterState>({ preset: "last-90-days", bucket: "week", unit: "AI_CREDITS", pricing: "as-of-use" });
  const [groupBy, setGroupBy] = useState<CostCompareGroupBy>(() => ((selections.project?.length ?? 0) === 0 && (selections.repository?.length ?? 0) > 0 ? "repository" : "project"));
  const [comparePeriod, setComparePeriod] = useState<ComparePeriod>("previous");
  const scope = useMemo(() => compareScope(groupBy, selections, possible[groupBy], placeholders), [groupBy, selections, possible, placeholders]);
  const range = useMemo(() => rangeFor(filters.preset, now), [filters.preset, now]);
  const { pricing, unit } = filters;
  const enough = scope.ids.length >= 2;
  const plural = groupBy === "project" ? "projects" : "repositories";

  const load = useCallback(
    async (signal: AbortSignal): Promise<Loaded> => {
      const provider = scope.providerId ? { provider: scope.providerId } : {};
      const [comparison, series] = await Promise.all([
        loadComparison(
          { since: range.since, until: range.until, groupBy, ids: scope.ids, basis, pricing, currency: "usd", ...(comparePeriod === "previous" ? {} : { comparePeriod }), ...provider },
          signal,
        ),
        loadSeries({ since: range.since, until: range.until, bucket: compareBucketFor(range), groupBy, ids: scope.ids, basis, pricing, ...provider }, signal),
      ]);
      return { comparison, series };
    },
    [scope, range, groupBy, basis, pricing, comparePeriod, loadComparison, loadSeries],
  );
  const { state, cancel, retry } = useCancellableLoad(load, enough);
  const palette = useMemo(() => new SeriesPalette(groupBy === "project" ? orders.project : orders.repository), [groupBy, orders]);
  const note = ignoredNote(scope.ignored, fieldLabel);

  return (
    <div className="cost-tab">
      <CostFilters name="cost-compare" label="Comparison filters" state={filters} onChange={setFilters} showBucket={false}>
        <div className="cost-filter" role="radiogroup" aria-label="Group by">
          <SegmentedControl name="cost-compare-group" options={GROUP_BY} value={groupBy} onChange={setGroupBy} />
        </div>
        <label className="cost-filter view-select">
          <span className="text-muted">Compare with</span>
          <select className="input" value={comparePeriod} onChange={(event) => setComparePeriod(event.target.value as ComparePeriod)}>
            {COMPARE_WITH.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </CostFilters>
      {note && <p className="text-muted cost-note">{note}</p>}
      <AsyncView
        status={!enough ? "empty" : state.kind === "ready" ? "ready" : state.kind === "cancelled" ? "empty" : state.kind}
        loadingText="Loading the comparison…"
        readyText="Comparison loaded."
        skeleton="table"
        onCancel={cancel}
        error={state.kind === "error" ? { title: `Could not load the comparison: ${state.message}`, onRetry: retry } : undefined}
        empty={
          !enough
            ? {
                title: `Compare needs two or more ${plural}.`,
                body: `Select ${plural} in the ${groupBy === "project" ? "Project" : "Repository"} list box, or clear selections that leave fewer than two.`,
              }
            : cancelledEmptyState(retry)
        }
      >
        {enough && state.kind === "ready" && (
          <CompareBody data={state.data} groupBy={groupBy} unit={unit} narrow={narrow} palette={palette} kicker={costKicker(["Compare", PRICING_LABEL[pricing], `${basis} basis`, comparePeriod === "previous" ? "vs previous period" : "vs last year"])} />
        )}
      </AsyncView>
    </div>
  );
}

interface CompareBodyProps {
  data: Loaded;
  groupBy: CostCompareGroupBy;
  unit: DisplayUnit;
  narrow: boolean;
  palette: SeriesPalette;
  kicker: string;
}

function rowLabel(row: { key: string | null; label: string }, groupBy: CostCompareGroupBy): string {
  return groupBy === "repository" && row.key !== null ? repositoryFolderLabel(row.label) : row.label;
}

function CompareBody({ data, groupBy, unit, narrow, palette, kicker }: CompareBodyProps) {
  const { comparison, series } = data;
  const [extra, setExtra] = useState<ColumnId[]>([]);
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const columns = COLUMNS.filter((column) => !narrow || PRIORITY.includes(column.id) || extra.includes(column.id));
  const rows = comparison.rows;
  const title = `${rows.length} ${groupBy === "project" ? "projects" : "repositories"}`;
  const nameHeader = groupBy === "project" ? "Project" : "Repository";
  const partial = rows.filter((row) => row.coverage.preferred.knownTurns < row.coverage.preferred.turns);
  const detailsRow = rows.find((row) => row.key === detailsFor);
  const lines = indexedLines(chartLines(series, { palette, unit }));
  const shares = rows.map((row) => ({ row, share: row.share.find((share) => share.currency === "USD")?.share ?? 0 }));

  return (
    <>
      <Blueprint className="audit-section">
        <section className="cost-compare" aria-labelledby="cost-compare-title">
          <div className="cost-figure-head">
            <div>
              <div className="card-kicker">{kicker}</div>
              <h4 id="cost-compare-title" className="cost-chart-title">
                {title}
              </h4>
            </div>
            {narrow && <ExtraColumns chosen={extra} onChange={setExtra} unit={unit} />}
          </div>
          <div className="table-scroll cost-compare-scroll">
            <table className="table cost-compare-table">
              <caption className="sr-only">Compare {title}</caption>
              <thead>
                <tr>
                  <th scope="col">{nameHeader}</th>
                  {columns.map((column) => (
                    <th key={column.id} scope="col" className="num">
                      {column.header(unit)}
                    </th>
                  ))}
                  {narrow && (
                    <th scope="col">
                      <span className="sr-only">Details</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} aria-selected={detailsFor === row.key ? true : undefined}>
                    <th scope="row">
                      <span className="cost-row-name">
                        <span className="chart-legend-swatch" style={{ background: palette.styleFor(row.key).color }} aria-hidden="true" />
                        {rowLabel(row, groupBy)}
                      </span>
                    </th>
                    {columns.map((column) => (
                      <td key={column.id} className="num">
                        {column.cell(row, unit)}
                      </td>
                    ))}
                    {narrow && (
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary cost-details-button"
                          aria-label={`Details for ${rowLabel(row, groupBy)}`}
                          aria-expanded={detailsFor === row.key}
                          onClick={() => setDetailsFor((current) => (current === row.key ? null : row.key))}
                        >
                          Details
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <SelectionRow comparison={comparison} columns={columns} unit={unit} narrow={narrow} />
              </tfoot>
            </table>
          </div>
          <p className="text-muted cost-footnote">
            {[
              ...partial.map(
                (row) =>
                  `${rowLabel(row, groupBy)}: ${formatPercent(coverageRatio(row.coverage.preferred), 0)} of turns have a known cost (${coverageNote(row.coverage.preferred)}), so its total covers only those; unknown is never counted as 0.`,
              ),
              `Figures in ${unitLabel(unit)}; ${unit === "AI_CREDITS" ? "USD figures" : "AI Credits"} converted at 1 AI Credit = $0.01.`,
            ].join(" ")}
          </p>
        </section>
      </Blueprint>

      <div className="audit-grid-2">
        <Blueprint className="audit-section">
          <div className="card-kicker">{costKicker(["Indexed", "first period = 100"])}</div>
          <h4 className="cost-chart-title">Growth, one scale for all</h4>
          <CostTimeChart
            ariaLabel="Indexed cost, first period = 100"
            lines={lines}
            bucket={series.bucket}
            format={(value) => value.toFixed(0)}
            formatTick={(value) => String(Math.round(value))}
            unitLabel="index"
            reference={100}
            emptyText="No known cost to index."
          />
        </Blueprint>
        <Blueprint className="audit-section">
          <div className="card-kicker">{costKicker(["Share of total", unitLabel(unit)])}</div>
          <h4 className="cost-chart-title">Where the money went</h4>
          <HorizontalBars
            ariaLabel="Share of total"
            series={rows.map((row) => ({ id: row.key, label: rowLabel(row, groupBy), color: palette.styleFor(row.key).color }))}
            rows={shares.map(({ row, share }) => ({ key: row.key, label: rowLabel(row, groupBy), values: { [row.key]: share } }))}
            format={(value) => formatPercent(value)}
            emptyText="No known cost."
          />
          <p className="text-muted cost-footnote">Bars, not a pie. Colours follow the {groupBy}, not its rank, so filtering never repaints them.</p>
        </Blueprint>
      </div>

      {narrow && detailsRow && (
        <Drawer title={rowLabel(detailsRow, groupBy)} onClose={() => setDetailsFor(null)}>
          <RowDetails row={detailsRow} unit={unit} />
        </Drawer>
      )}
    </>
  );
}

function SelectionRow({ comparison, columns, unit, narrow }: { comparison: CostComparison; columns: readonly Column[]; unit: DisplayUnit; narrow: boolean }) {
  const rows = comparison.rows;
  const current = comparison.total.usd;
  const previousKnown = rows.every((row) => row.previous.total.usd !== null && row.total.usd !== null);
  const previous = previousKnown ? rows.reduce((sum, row) => sum + row.previous.total.usd!, 0) : null;
  const sessions = rows.reduce((sum, row) => sum + row.sessions, 0);
  const coverage = rows.reduce((sum, row) => ({ turns: sum.turns + row.coverage.preferred.turns, knownTurns: sum.knownTurns + row.coverage.preferred.knownTurns }), { turns: 0, knownTurns: 0 });
  const cells: Partial<Record<ColumnId, string>> = {
    total: formatAmount(usdIn(current, unit), unit),
    change: formatChange(current === null || previous === null || previous === 0 ? null : (current - previous) / previous),
    perSession: current === null || sessions === 0 ? "unknown" : formatAmount(usdIn(current / sessions, unit), unit),
    share: "100.0%",
    coverage: formatPercent(coverageRatio(coverage), 0),
  };
  return (
    <tr>
      <th scope="row">Selection</th>
      {columns.map((column) => (
        <td key={column.id} className="num">
          {cells[column.id] ?? ""}
        </td>
      ))}
      {narrow && <td />}
    </tr>
  );
}

function RowDetails({ row, unit }: { row: CostComparisonRow; unit: DisplayUnit }) {
  const entries: [string, string][] = [
    [`Total (${unitLabel(unit)})`, formatAmount(usdIn(row.total.usd, unit), unit)],
    ["Previous period", formatAmount(usdIn(row.previous.total.usd, unit), unit)],
    ["Change", formatChange(changeRatio(row))],
    [`Per session (${row.sessions} sessions)`, formatAmount(usdIn(firstUsd(row.perSession), unit), unit)],
    [`Per active day (${row.activeDays} days)`, formatAmount(usdIn(firstUsd(row.perActiveDay), unit), unit)],
    [`Per turn (${row.turns} turns)`, formatAmount(usdIn(firstUsd(row.perTurn), unit), unit)],
    ["Share of selection", formatPercent(row.share.find((share) => share.currency === "USD")?.share ?? null)],
    ["Cache-hit ratio", formatPercent(row.cacheHitRatio)],
    ["Output share", formatPercent(row.outputShare)],
    ["Coverage", `${formatPercent(coverageRatio(row.coverage.preferred), 0)} · ${coverageNote(row.coverage.preferred)}`],
    ["Known by basis (turns)", `billed ${row.coverage.billed.knownTurns} · reported ${row.coverage.reported.knownTurns} · priced ${row.coverage.priced.knownTurns}`],
  ];
  return (
    <dl className="cost-details">
      {entries.map(([term, value]) => (
        <div key={term} className="cost-details-entry">
          <dt className="text-muted">{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Below 700 px: which non-priority columns stay. A disclosure, as the turns
// table's column chooser is; Escape closes it, back on its button.
function ExtraColumns({ chosen, onChange, unit }: { chosen: ColumnId[]; onChange: (columns: ColumnId[]) => void; unit: DisplayUnit }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const optional = COLUMNS.filter((column) => !PRIORITY.includes(column.id));

  useEffect(() => {
    if (!open) return;
    function closeOnOutside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [open]);

  function onKeyDown(event: KeyboardEvent) {
    if (open && event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    }
  }

  return (
    <div ref={root} className="column-chooser" onKeyDown={onKeyDown}>
      <button ref={button} type="button" className="btn btn-secondary" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((current) => !current)}>
        Columns
      </button>
      {open && (
        <fieldset id={panelId} className="column-chooser-panel">
          <legend className="card-kicker">More columns</legend>
          {optional.map((column) => (
            <label key={column.id} className="column-chooser-option">
              <input
                type="checkbox"
                checked={chosen.includes(column.id)}
                onChange={() => onChange(chosen.includes(column.id) ? chosen.filter((id) => id !== column.id) : [...chosen, column.id])}
              />
              {column.header(unit).replace(/ \(.*\)$/, "")}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
