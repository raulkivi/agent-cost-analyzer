import { useCallback, useMemo, useState } from "react";
import {
  buildCostReconciliation,
  type CostBasisChoice,
  type CostVariance,
  type InsightFinding,
  type InsightTurnRow,
  type ProjectCost,
} from "@agent-cost-analyzer/domain";
import { fetchCostVariance, fetchProjectCost, type CostVarianceQuery, type ProjectCostQuery } from "../../api-client/cost-analysis.js";
import { HorizontalBars } from "../../charts/HorizontalBars.js";
import { Waterfall } from "../../charts/Waterfall.js";
import { formatAmount, unitLabel, usdIn, type DisplayUnit } from "../../lib/cost/cost-format.js";
import { rangeFor } from "../../lib/cost/date-ranges.js";
import { defaultPeriods, formatSigned, monthLabel, monthsOf, projectScope, waterfallSteps } from "../../lib/cost/project-model.js";
import { formatCompact } from "../../lib/audit-format.js";
import { SEVERITY_LABELS } from "../../lib/insights/insights-model.js";
import { useCancellableLoad } from "../../lib/use-cancellable-load.js";
import { AsyncView, cancelledEmptyState } from "../ui/AsyncView.js";
import { Blueprint } from "../ui/Blueprint.js";
import { CostFilters, costKicker, PRICING_LABEL, type CostFilterState } from "./CostFilters.js";
import { ignoredNote } from "./CostOverTimeTab.js";

// Phase 15 step 15.10 (plan §8.3, §8.4, §11.4; board 3, Project.dc.html):
// the Dashboard's Project tab, inside the one project the list boxes
// select. Cost by vendor (click one for its models) with tokens by type as
// a separate chart, not stacked into the first; "why cost changed" as a
// waterfall from one month to another (usage, price and mix, which add up
// exactly, on the priced basis as of use); and the billed-versus-priced
// reconciliation for Copilot turns, with observed price changes as
// findings (severity as text and icon, never colour alone). Figures are
// asked for in USD and shown in the picked unit at 1 AI Credit = $0.01.

type Selections = Readonly<Record<string, readonly string[]>>;

const TOKEN_TYPES = [
  { id: "uncachedInput", label: "Uncached input" },
  { id: "cacheWrite", label: "Cache write" },
  { id: "cacheRead", label: "Cache read" },
  { id: "reasoning", label: "Reasoning" },
  { id: "output", label: "Output" },
] as const;

const SINGLE_SERIES = (label: string) => [{ id: "value", label, color: "var(--color-series-1)" }];

interface ProjectTabProps {
  selections: Selections;
  fieldLabel: (fieldId: string) => string;
  placeholders: { project: string; repository: string };
  basis: CostBasisChoice;
  now: Date;
  // The Dashboard's dataset rows: price-change findings and Copilot turns
  // (billed and priced figures) for the reconciliation.
  findings: readonly InsightFinding[];
  turns: readonly InsightTurnRow[];
  loadProjectCost?: (query: ProjectCostQuery, signal: AbortSignal) => Promise<ProjectCost>;
  loadVariance?: (query: CostVarianceQuery, signal: AbortSignal) => Promise<CostVariance>;
}

export function ProjectTab({
  selections,
  fieldLabel,
  placeholders,
  basis,
  now,
  findings,
  turns,
  loadProjectCost = fetchProjectCost,
  loadVariance = fetchCostVariance,
}: ProjectTabProps) {
  const [filters, setFilters] = useState<CostFilterState>({ preset: "last-90-days", bucket: "month", unit: "AI_CREDITS", pricing: "as-of-use" });
  const scope = useMemo(() => projectScope(selections, placeholders), [selections, placeholders]);
  const range = useMemo(() => rangeFor(filters.preset, now), [filters.preset, now]);
  const months = useMemo(() => monthsOf(range), [range]);
  const [periods, setPeriods] = useState(() => defaultPeriods(months));
  const [periodsFor, setPeriodsFor] = useState(months.join());
  // A new range resets the compared months to its first and last.
  if (periodsFor !== months.join()) {
    setPeriodsFor(months.join());
    setPeriods(defaultPeriods(months));
  }
  const ready = "projectId" in scope;
  const projectId = ready ? scope.projectId : "";
  const providerId = ready ? scope.providerId : undefined;
  const { pricing, unit } = filters;

  const loadCost = useCallback(
    (signal: AbortSignal) =>
      loadProjectCost({ projectId, since: range.since, until: range.until, basis, pricing, currency: "usd", ...(providerId ? { provider: providerId } : {}) }, signal),
    [projectId, providerId, range, basis, pricing, loadProjectCost],
  );
  const cost = useCancellableLoad(loadCost, ready);
  const loadChange = useCallback(
    (signal: AbortSignal) =>
      loadVariance({ groupBy: "project", id: projectId, periodA: periods.a, periodB: periods.b, currency: "usd", ...(providerId ? { provider: providerId } : {}) }, signal),
    [projectId, providerId, periods, loadVariance],
  );
  const variance = useCancellableLoad(loadChange, ready);
  const note = ready ? ignoredNote(scope.ignored, fieldLabel) : undefined;

  return (
    <div className="cost-tab">
      <CostFilters name="cost-project" label="Project filters" state={filters} onChange={setFilters} showBucket={false} />
      {note && <p className="text-muted cost-note">{note}</p>}
      {!ready ? (
        <AsyncView status="empty" loadingText="Loading the project…" empty={{ title: scope.reason, body: "The Project tab looks inside one project: its vendors, models and why its cost changed." }}>
          {null}
        </AsyncView>
      ) : (
        <>
          <AsyncView
            status={cost.state.kind === "ready" ? "ready" : cost.state.kind === "cancelled" ? "empty" : cost.state.kind}
            loadingText="Loading the project's cost…"
            readyText="Project cost loaded."
            onCancel={cost.cancel}
            error={cost.state.kind === "error" ? { title: `Could not load the project's cost: ${cost.state.message}`, onRetry: cost.retry } : undefined}
            empty={cancelledEmptyState(cost.retry)}
          >
            {cost.state.kind === "ready" && (
              <VendorBreakdown cost={cost.state.data} unit={unit} kicker={costKicker([cost.state.data.project.name, PRICING_LABEL[pricing], `${basis} basis`])} />
            )}
          </AsyncView>
          <Blueprint className="audit-section">
            <section className="cost-variance" aria-labelledby="cost-variance-title">
              <div className="cost-figure-head">
                <div>
                  <div className="card-kicker">{costKicker(["All vendors", "priced basis, as of use", unitLabel(unit)])}</div>
                  <h4 id="cost-variance-title" className="cost-chart-title">
                    Why cost changed: {monthLabel(periods.a)} to {monthLabel(periods.b)}
                  </h4>
                </div>
                <div className="cost-variance-periods">
                  <MonthSelect label="From" value={periods.a} months={months} onChange={(a) => setPeriods((current) => ({ ...current, a }))} />
                  <MonthSelect label="To" value={periods.b} months={months} onChange={(b) => setPeriods((current) => ({ ...current, b }))} />
                </div>
              </div>
              <AsyncView
                status={variance.state.kind === "ready" ? "ready" : variance.state.kind === "cancelled" ? "empty" : variance.state.kind}
                loadingText="Loading why cost changed…"
                onCancel={variance.cancel}
                error={variance.state.kind === "error" ? { title: `Could not explain the change: ${variance.state.message}`, onRetry: variance.retry } : undefined}
                empty={cancelledEmptyState(variance.retry)}
              >
                {variance.state.kind === "ready" && <VarianceBody variance={variance.state.data} unit={unit} />}
              </AsyncView>
            </section>
          </Blueprint>
          <Reconciliation projectId={projectId} range={range} unit={unit} findings={findings} turns={turns} />
        </>
      )}
    </div>
  );
}

function MonthSelect({ label, value, months, onChange }: { label: string; value: string; months: readonly string[]; onChange: (month: string) => void }) {
  const options = months.includes(value) ? months : [value, ...months];
  return (
    <label className="cost-filter view-select">
      <span className="text-muted">{label}</span>
      <select className="input" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((month) => (
          <option key={month} value={month}>
            {monthLabel(month)}
          </option>
        ))}
      </select>
    </label>
  );
}

function VendorBreakdown({ cost, unit, kicker }: { cost: ProjectCost; unit: DisplayUnit; kicker: string }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const vendors = cost.byVendor;
  const vendor = vendors.find((row) => row.key === chosen) ?? vendors[0];
  const format = (value: number) => formatAmount(value, unit);
  const shown = (usd: number | null) => usdIn(usd, unit) ?? 0;
  const vendorName = vendor?.label ?? "No vendor";
  const tokens = cost.byTokenType.filter((row) => vendor !== undefined && row.vendorId === vendor.key);
  const tokenRows = TOKEN_TYPES.map((type) => ({ key: type.id, label: type.label, values: { value: tokens.reduce((sum, row) => sum + (row[type.id].value ?? 0), 0) } }));
  const total = formatAmount(usdIn(cost.total.usd, unit), unit);

  return (
    <div className="cost-project-grid">
      <Blueprint className="audit-section">
        <section aria-labelledby="cost-vendor-title">
          <div className="card-kicker">{costKicker([kicker, `${total} ${unitLabel(unit)}`])}</div>
          <h4 id="cost-vendor-title" className="cost-chart-title">
            Cost by vendor
          </h4>
          <HorizontalBars
            ariaLabel={`Cost by vendor (${unitLabel(unit)})`}
            series={SINGLE_SERIES(unitLabel(unit))}
            rows={vendors.map((row) => ({ key: row.key ?? "", label: row.label, values: { value: shown(row.cost.usd) } }))}
            selectedKey={vendor?.key ?? undefined}
            onSelect={setChosen}
            format={format}
            emptyText="No cost in this project and range."
          />
          <p className="text-muted cost-note">Click a vendor to see its models.</p>
        </section>
      </Blueprint>
      <Blueprint className="audit-section">
        <section aria-labelledby="cost-models-title">
          <div className="card-kicker">{costKicker([vendorName, `${formatAmount(usdIn(vendor?.cost.usd ?? null, unit), unit)} ${unitLabel(unit)}`])}</div>
          <h4 id="cost-models-title" className="cost-chart-title">
            Models, and the tokens their cost is made of
          </h4>
          <div className="cost-chart-stack">
            <div>
              <p className="text-muted cost-subchart-label">By model ({unitLabel(unit)})</p>
              <HorizontalBars
                ariaLabel={`${vendorName} models`}
                series={SINGLE_SERIES(unitLabel(unit))}
                rows={(vendor?.models ?? []).map((row) => ({ key: row.key ?? row.label, label: row.label, values: { value: shown(row.cost.usd) } }))}
                format={format}
                emptyText="No models."
              />
            </div>
            <div>
              <p className="text-muted cost-subchart-label">Tokens by type (a separate chart, not stacked into the one above)</p>
              <HorizontalBars ariaLabel={`${vendorName} tokens by type`} series={SINGLE_SERIES("Tokens")} rows={tokenRows} format={formatCompact} emptyText="No tokens." />
            </div>
          </div>
        </section>
      </Blueprint>
    </div>
  );
}

function VarianceBody({ variance, unit }: { variance: CostVariance; unit: DisplayUnit }) {
  const labels = { a: monthLabel(variance.periodA.label), b: monthLabel(variance.periodB.label) };
  const unexplained = [
    [variance.notExplained.periodA, labels.a],
    [variance.notExplained.periodB, labels.b],
  ] as const;
  return (
    <>
      {variance.currencies.length === 0 ? (
        <p className="text-muted chart-empty">No priced turns in either month, so there is nothing to explain.</p>
      ) : (
        variance.currencies.map((row) => (
          <Waterfall key={row.currency} ariaLabel={`Why cost changed: ${labels.a} to ${labels.b}`} steps={waterfallSteps(row, unit, labels)} unit={unit} />
        ))
      )}
      {unexplained.map(([part, label]) =>
        part.turns > 0 ? (
          <p key={label} className="text-muted cost-note">
            {part.turns} turns in {label} have no priced figure and are not explained{part.reasons ? ` (${part.reasons.join("; ")})` : ""}.
          </p>
        ) : null,
      )}
      <p className="text-muted cost-note">
        Priced basis, as of use: usage is more or fewer tokens at {labels.a}'s average price, price is {labels.b}'s tokens × the change in unit price, mix is work moved
        between models. They add up exactly to the change.
        {variance.priceChanges.length > 0 && ` Documented price changes between the months: ${variance.priceChanges.map((change) => `${change.modelId} on ${change.date}`).join(", ")}.`}
      </p>
    </>
  );
}

function Reconciliation({
  projectId,
  range,
  unit,
  findings,
  turns,
}: {
  projectId: string;
  range: { since: string; until: string };
  unit: DisplayUnit;
  findings: readonly InsightFinding[];
  turns: readonly InsightTurnRow[];
}) {
  const inScope = turns.filter((turn) => turn.projectId === projectId && turn.date !== undefined && turn.date >= range.since && turn.date <= range.until);
  const rows = buildCostReconciliation(inScope.flatMap((turn) => (turn.cost ? [{ month: turn.date!.slice(0, 7), model: turn.model, cost: turn.cost }] : [])));
  const models = [...new Set(rows.map((row) => row.model))].sort();
  const months = [...new Set(rows.map((row) => row.month))].sort();
  const sessions = new Set(inScope.map((turn) => turn.sessionKey));
  const observed = findings.filter((finding) => finding.kind === "price-change" && sessions.has(finding.sessionKey));
  const cell = (model: string, month: string) => {
    const row = rows.find((candidate) => candidate.model === model && candidate.month === month);
    return row?.difference === null || row === undefined ? "unknown" : formatSigned(usdIn(row.difference * 0.01, unit)!, unit);
  };

  return (
    <Blueprint className="audit-section">
      <section aria-labelledby="cost-reconciliation-title">
        <div className="card-kicker">Copilot turns · billed vs price book</div>
        <h4 id="cost-reconciliation-title" className="cost-chart-title">
          Reconciliation
        </h4>
        {observed.map((finding) => (
          <div key={finding.key} className="cost-finding">
            <span className={`severity-tag severity-tag--${finding.severity}`}>{SEVERITY_LABELS[finding.severity]}</span>
            <div>
              <strong>{finding.title}</strong>
              <p className="text-muted">{finding.why}</p>
              {finding.evidence && <p className="text-muted">{finding.evidence}</p>}
            </div>
          </div>
        ))}
        {rows.length === 0 ? (
          <p className="text-muted chart-empty">No Copilot turns with both a billed and a priced figure in this project and range.</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <caption>Billed minus priced, per model and month ({unitLabel(unit)})</caption>
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  {months.map((month) => (
                    <th key={month} scope="col" className="num">
                      {monthLabel(month)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {models.map((model) => (
                  <tr key={model}>
                    <th scope="row">{model}</th>
                    {months.map((month) => (
                      <td key={month} className="num">
                        {cell(model, month)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Blueprint>
  );
}
