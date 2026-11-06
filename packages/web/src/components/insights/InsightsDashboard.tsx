import { useCallback, useMemo, useState } from "react";
import { AI_CREDIT_CONVERSION_NOTE, redactRepositoryKey, type CostBasisChoice, type CostComparison, type CostSeries, type CostVariance, type ProjectCost } from "@agent-cost-analyzer/domain";
import type {
  FailureCategory,
  InsightFinding,
  InsightSessionRow,
  InsightsDataset,
  InsightToolCallRow,
  InsightTurnRow,
} from "@agent-cost-analyzer/domain";
import type { CostCompareQuery, CostSeriesQuery, CostVarianceQuery, ProjectCostQuery } from "../../api-client/cost-analysis.js";
import { fetchInsights, type InsightsQuery } from "../../api-client/insights.js";
import { HorizontalBars } from "../../charts/HorizontalBars.js";
import { TrendColumns } from "../../charts/TrendColumns.js";
import { createAssociativeEngine } from "../../lib/associative/engine.js";
import { back, clearAll, clearField, commit, emptyHistory, selectOnly, toggleValue } from "../../lib/associative/selections.js";
import { CATEGORY_LABELS, formatCompact, formatFailureRate, STATUS_META } from "../../lib/audit-format.js";
import { createInsightsModel, FIELD, LIST_BOX_GROUPS, NO_PROJECT, SEVERITY_ORDER, TABLE, UNATTRIBUTED, type FieldId } from "../../lib/insights/insights-model.js";
import {
  aiCreditsByDay,
  computeKpis,
  costTotalFor,
  countBy,
  formatCostTotal,
  TOKEN_KINDS,
  tokensByModel,
  toolCallsByTool,
  topSessionsByCredits,
  type InsightRowsView,
} from "../../lib/insights/measures.js";
import { buildNarrative } from "../../lib/insights/narrative.js";
import { formatUsd } from "../../lib/ai-credits-usd.js";
import { useCancellableLoad } from "../../lib/use-cancellable-load.js";
import { useContainerWidth } from "../../lib/use-container-width.js";
import { AsyncView, cancelledEmptyState } from "../ui/AsyncView.js";
import { Blueprint } from "../ui/Blueprint.js";
import { SegmentedControl } from "../ui/SegmentedControl.js";
import { StatTile } from "../ui/StatTile.js";
import { CompareTab } from "./CompareTab.js";
import { CostOverTimeTab, type CostOrders } from "./CostOverTimeTab.js";
import { CurrentSelections } from "./CurrentSelections.js";
import { ProjectTab } from "./ProjectTab.js";
import { FindingsTable } from "./FindingsTable.js";
import { ListBox } from "./ListBox.js";

type RangePreset = "7" | "30" | "90" | "all";

const RANGE_OPTIONS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "all", label: "All time" },
] as const;

// Most recent sessions per provider — enough history for anomaly and
// behaviour-change baselines without parsing every log on disk.
const SESSIONS_PER_PROVIDER = 200;
const TOP_SESSIONS = 10;

const TOKEN_SERIES = [
  { id: "uncachedInput", label: "Uncached input", color: "#2c455d" },
  { id: "cacheWrite", label: "Cache write", color: "#eba524" },
  { id: "cacheRead", label: "Cache read", color: "#94bce3" },
  { id: "reasoning", label: "Reasoning", color: "#7a7a7d" },
  { id: "output", label: "Output", color: "#597ea3" },
];

const TOOL_SERIES = [
  { id: "succeeded", label: "Succeeded", color: STATUS_META.success.color },
  { id: "failed", label: "Failed", color: STATUS_META.error.color },
  { id: "unknown", label: "Unknown", color: STATUS_META.unknown.color },
];

// Step 15.6 (plan §5, D3): totals use each turn's preferred basis unless the
// view picks one.
const COST_BASIS_OPTIONS = [
  { value: "preferred", label: "Preferred" },
  { value: "billed", label: "Billed" },
  { value: "reported", label: "Reported" },
  { value: "priced", label: "Priced" },
] as const;

// Phase 15 step 15.9 (plan §11.1): the Dashboard's views. Step 15.10 adds
// Project; Billing follows in step 15.11.
type DashboardView = "overview" | "cost-over-time" | "compare" | "project";
const VIEW_OPTIONS = [
  { value: "overview", label: "Overview" },
  { value: "cost-over-time", label: "Cost over time" },
  { value: "compare", label: "Compare" },
  { value: "project", label: "Project" },
] as const;
// Below this the views are a select (plan §11.1), as the session view's are.
const VIEW_SELECT_BELOW = 700;
const PLACEHOLDERS = { project: NO_PROJECT, repository: UNATTRIBUTED };

const FAILED_SERIES = [{ id: "failed", label: "Failed", color: STATUS_META.error.color }];
const CALLS_SERIES = [{ id: "calls", label: "Calls", color: STATUS_META.success.color }];

function queryFor(preset: RangePreset, now: Date): InsightsQuery {
  if (preset === "all") {
    return { limit: SESSIONS_PER_PROVIDER };
  }
  const since = new Date(now.getTime() - Number(preset) * 24 * 60 * 60 * 1000);
  return { since: since.toISOString().slice(0, 10), limit: SESSIONS_PER_PROVIDER };
}

interface InsightsDashboardProps {
  loadDataset?: (query: InsightsQuery, signal: AbortSignal) => Promise<InsightsDataset>;
  now?: Date;
  // ProductProfile.features.crossProviderInsights (vscode-extension.md G10):
  // false for a single-provider product, which then gets no Provider list
  // box or column and no cross-provider wording.
  crossProvider?: boolean;
  // ProductProfile.features.costAnalysis (step 15.9): the Cost over time and
  // Compare tabs over GET /api/cost/*; off in the extension until step 15.14.
  costAnalysis?: boolean;
  loadCostSeries?: (query: CostSeriesQuery, signal: AbortSignal) => Promise<CostSeries>;
  loadCostComparison?: (query: CostCompareQuery, signal: AbortSignal) => Promise<CostComparison>;
  // Step 15.10: the Project tab.
  loadProjectCost?: (query: ProjectCostQuery, signal: AbortSignal) => Promise<ProjectCost>;
  loadCostVariance?: (query: CostVarianceQuery, signal: AbortSignal) => Promise<CostVariance>;
}

// The list boxes, without the Provider facet for a single-provider product.
function listBoxGroups(crossProvider: boolean) {
  return crossProvider
    ? LIST_BOX_GROUPS
    : LIST_BOX_GROUPS.map((group) => ({ ...group, fields: group.fields.filter((fieldId) => fieldId !== FIELD.provider) }));
}

// Phase 9.11 (docs/plans/insights-dashboard.md): a QlikView-style
// associative dashboard across every log provider (or the only one, in a
// single-provider product) — list boxes, current
// selections with Back, KPIs, clickable charts, and security/anomaly/
// behaviour-change signals that say what happened, when and why.
export function InsightsDashboard({
  loadDataset = fetchInsights,
  now,
  crossProvider = true,
  costAnalysis = false,
  loadCostSeries,
  loadCostComparison,
  loadProjectCost,
  loadCostVariance,
}: InsightsDashboardProps) {
  const [preset, setPreset] = useState<RangePreset>("30");
  const [nowTime] = useState(() => (now ?? new Date()).getTime());
  // The load is cancellable (Cancel on its skeleton): the signal reaches the
  // transport, which stops waiting (and tells the extension host to).
  const loadFor = useCallback(
    (signal: AbortSignal) => loadDataset(queryFor(preset, new Date(nowTime)), signal),
    [preset, loadDataset, nowTime],
  );
  const { state, cancel, retry } = useCancellableLoad(loadFor);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>{crossProvider ? "Insights across all providers" : "Insights"}</h3>
        <SegmentedControl name="insights-range" options={RANGE_OPTIONS} value={preset} onChange={setPreset} />
      </div>
      <AsyncView
        status={
          state.kind === "ready"
            ? state.data.sessions.length === 0
              ? "empty"
              : "ready"
            : state.kind === "cancelled"
              ? "empty"
              : state.kind
        }
        loadingText={crossProvider ? "Loading sessions from every provider…" : "Loading sessions…"}
        readyText="Insights loaded."
        skeleton="table"
        onCancel={cancel}
        error={
          state.kind === "error" ? { title: `Could not load insights: ${state.message}`, onRetry: retry } : undefined
        }
        empty={
          state.kind === "cancelled"
            ? cancelledEmptyState(retry)
            : {
                title: crossProvider ? "No sessions in this date range from any provider." : "No sessions in this date range.",
                body: (state.kind === "ready" && providerNotes(state.data).join(" · ")) || "Sessions started before the range aren't counted.",
                action: preset === "all" ? undefined : { label: "Show all time", onClick: () => setPreset("all") },
              }
        }
        partial={state.kind === "ready" ? providerNotes(state.data).join(" · ") || undefined : undefined}
      >
        {state.kind === "ready" && (
          <DashboardBody
            dataset={state.data}
            crossProvider={crossProvider}
            costAnalysis={costAnalysis}
            now={new Date(nowTime)}
            loadCostSeries={loadCostSeries}
            loadCostComparison={loadCostComparison}
            loadProjectCost={loadProjectCost}
            loadCostVariance={loadCostVariance}
            key={state.data.generatedAt + preset}
          />
        )}
      </AsyncView>
    </div>
  );
}

// Providers whose sessions are missing or cut short: partial data (§3.5).
function providerNotes(dataset: InsightsDataset): string[] {
  return dataset.providers.flatMap((provider) => {
    if (!provider.available) {
      return [`${provider.label}: ${provider.unavailableReason ?? "not available"}`];
    }
    if (provider.error) {
      return [`${provider.label}: failed to load (${provider.error})`];
    }
    if (provider.truncated) {
      return [`${provider.label}: showing the ${provider.sessionCount} most recent sessions`];
    }
    return [];
  });
}

interface DashboardBodyProps {
  dataset: InsightsDataset;
  crossProvider: boolean;
  costAnalysis: boolean;
  now: Date;
  loadCostSeries?: InsightsDashboardProps["loadCostSeries"];
  loadCostComparison?: InsightsDashboardProps["loadCostComparison"];
  loadProjectCost?: InsightsDashboardProps["loadProjectCost"];
  loadCostVariance?: InsightsDashboardProps["loadCostVariance"];
}

// Plan §11.7: a project's colour is its position in the projects file; a
// repository's its place among every repository in the dataset, sorted (as
// the API names them, local keys by folder), so filtering never repaints.
function costOrders(dataset: InsightsDataset): CostOrders {
  const repositories = new Set<string>();
  for (const row of [...dataset.sessions, ...dataset.turns]) {
    if (row.repositoryKey) repositories.add(redactRepositoryKey(row.repositoryKey));
  }
  return { project: (dataset.projects ?? []).map((project) => project.id), repository: [...repositories].sort() };
}

function DashboardBody({ dataset, crossProvider, costAnalysis, now, loadCostSeries, loadCostComparison, loadProjectCost, loadCostVariance }: DashboardBodyProps) {
  const model = useMemo(() => createInsightsModel(dataset), [dataset]);
  const orders = useMemo(() => costOrders(dataset), [dataset]);
  const [dashboardView, setDashboardView] = useState<DashboardView>("overview");
  const [measure, mainWidth] = useContainerWidth<HTMLDivElement>();
  const engine = useMemo(() => createAssociativeEngine(model), [model]);
  const [history, setHistory] = useState(emptyHistory);
  const [costBasis, setCostBasis] = useState<CostBasisChoice>("preferred");
  const selections = history.present;
  const evaluation = useMemo(() => engine.evaluate(selections), [engine, selections]);

  const view: InsightRowsView = {
    sessions: evaluation.rows<InsightSessionRow>(TABLE.sessions),
    turns: evaluation.rows<InsightTurnRow>(TABLE.turns),
    toolCalls: evaluation.rows<InsightToolCallRow>(TABLE.toolCalls),
    findings: evaluation.rows<InsightFinding>(TABLE.findings),
  };
  const kpis = computeKpis(view);
  const cost = costTotalFor(view.turns, costBasis);
  const inAll = cost.amounts.length > 1 && cost.usd !== null ? ` · about ${formatUsd(cost.usd)} in all at` : " ·";
  const apiEquivalentNote = cost.apiEquivalentTurns > 0 ? ` · ${cost.apiEquivalentTurns} API-equivalent` : "";
  const fieldsById = new Map(model.fields.map((field) => [field.id, field]));
  const fieldLabel = (fieldId: string) => fieldsById.get(fieldId)?.label ?? fieldId;
  const valueLabel = (fieldId: string, value: string) => fieldsById.get(fieldId)?.display?.(value) ?? value;
  const sessionTitles = new Map(dataset.sessions.map((session) => [session.key, session.title]));
  const singleSelected = (fieldId: FieldId) => (selections[fieldId]?.length === 1 ? selections[fieldId]![0] : undefined);

  // A grouping field's values still selected or possible, in the fixed
  // colour order (then the rest by label).
  function possibleValues(fieldId: FieldId, order: readonly string[]): string[] {
    const values = evaluation
      .values(fieldId)
      .filter((value) => value.state === "selected" || value.state === "possible")
      .map((value) => value.value);
    const rank = (value: string) => (order.includes(value) ? order.indexOf(value) : order.length);
    return [...values].sort((a, b) => rank(a) - rank(b));
  }

  function select(fieldId: FieldId, value: string, additive = false) {
    setHistory((current) =>
      commit(current, additive ? toggleValue(current.present, fieldId, value) : selectOnly(current.present, fieldId, value)),
    );
  }

  const severityNote = SEVERITY_ORDER.filter((severity) => kpis.securityFindingsBySeverity[severity] > 0 && severity !== "info")
    .map((severity) => `${kpis.securityFindingsBySeverity[severity]} ${severity}`)
    .join(", ");
  const highOrWorse = kpis.securityFindingsBySeverity.critical + kpis.securityFindingsBySeverity.high;

  return (
    <div className="insights-layout">
      <aside className="insights-listboxes" aria-label="Fields">
        {listBoxGroups(crossProvider).map((group) => (
          <div key={group.title} className="insights-listbox-group">
            <h6 style={{ margin: 0 }}>{group.title}</h6>
            {group.fields.map((fieldId) => (
              <ListBox
                key={fieldId}
                label={fieldLabel(fieldId)}
                values={evaluation.values(fieldId)}
                onSelect={(value, additive) => select(fieldId, value, additive)}
                onClear={() => setHistory((current) => commit(current, clearField(current.present, fieldId)))}
              />
            ))}
          </div>
        ))}
        <ul className="listbox-legend" aria-label="List box colours">
          <li><span className="listbox-swatch listbox-value--selected" /> Selected</li>
          <li><span className="listbox-swatch listbox-value--possible" /> Possible</li>
          <li><span className="listbox-swatch listbox-value--alternative" /> Alternative</li>
          <li><span className="listbox-swatch listbox-value--excluded" /> Excluded</li>
        </ul>
      </aside>

      <div className="insights-main" ref={measure}>
        {costAnalysis && <ViewSwitch value={dashboardView} onChange={setDashboardView} asSelect={mainWidth !== undefined && mainWidth > 0 && mainWidth < VIEW_SELECT_BELOW} />}
        <CurrentSelections
          selections={selections}
          fieldLabel={fieldLabel}
          valueLabel={valueLabel}
          canGoBack={history.past.length > 0}
          onClearField={(fieldId) => setHistory((current) => commit(current, clearField(current.present, fieldId)))}
          onClearAll={() => setHistory((current) => commit(current, clearAll()))}
          onBack={() => setHistory(back)}
        />

        {dashboardView === "cost-over-time" ? (
          <CostOverTimeTab
            selections={selections}
            fieldLabel={fieldLabel}
            orders={orders}
            placeholders={PLACEHOLDERS}
            basis={costBasis}
            now={now}
            loadSeries={loadCostSeries}
          />
        ) : dashboardView === "project" ? (
          <ProjectTab
            selections={selections}
            fieldLabel={fieldLabel}
            placeholders={PLACEHOLDERS}
            basis={costBasis}
            now={now}
            findings={dataset.findings}
            turns={dataset.turns}
            {...(loadProjectCost ? { loadProjectCost } : {})}
            {...(loadCostVariance ? { loadVariance: loadCostVariance } : {})}
          />
        ) : dashboardView === "compare" ? (
          <CompareTab
            selections={selections}
            possible={{ project: possibleValues(FIELD.project, orders.project), repository: possibleValues(FIELD.repository, []) }}
            fieldLabel={fieldLabel}
            orders={orders}
            placeholders={PLACEHOLDERS}
            basis={costBasis}
            now={now}
            narrow={mainWidth !== undefined && mainWidth > 0 && mainWidth < VIEW_SELECT_BELOW}
            loadComparison={loadCostComparison}
            loadSeries={loadCostSeries}
          />
        ) : (
          <>
          <Blueprint className="audit-section">
            <section role="region" aria-label="What happened">
              <div className="card-kicker">What happened</div>
              <ul className="insights-narrative">
                {buildNarrative(view, { crossProvider }).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          </Blueprint>

          <div className="insights-cost-basis" role="group" aria-label="Cost basis for totals">
            <span className="text-muted" style={{ fontSize: 12 }}>Cost basis for totals</span>
            <SegmentedControl name="insights-cost-basis" options={COST_BASIS_OPTIONS} value={costBasis} onChange={setCostBasis} />
          </div>

          <div className="stat-tiles">
            <StatTile
              label="Cost"
              value={formatCostTotal(cost)}
              note={`${cost.knownTurns} of ${cost.turns} turns known${apiEquivalentNote}${inAll} ${AI_CREDIT_CONVERSION_NOTE}`}
            />
            <StatTile
              label="AI Credits"
              value={kpis.aiCredits.known > 0 ? kpis.aiCredits.total.toFixed(2) : "—"}
              note={`${kpis.aiCredits.known} of ${kpis.aiCredits.count} turns known`}
            />
            <StatTile label="Sessions" value={String(kpis.sessions)} />
            <StatTile label="Turns" value={formatCompact(kpis.turns)} />
            <StatTile
              label="Cache hit ratio"
              value={kpis.cacheHitRatio === null ? "—" : `${Math.round(kpis.cacheHitRatio * 100)}%`}
              note="cache read ÷ all input"
            />
            <StatTile
              label="Output tokens"
              value={kpis.output.known > 0 ? formatCompact(kpis.output.total) : "—"}
              note={`${kpis.output.known} of ${kpis.output.count} turns known`}
            />
            <StatTile label="Tool calls" value={formatCompact(kpis.toolCalls)} />
            <StatTile
              label="Failure rate"
              value={formatFailureRate(kpis.failureRate)}
              note={`${kpis.failed} of ${kpis.knownOutcomes} with a known outcome`}
              alert={kpis.failed > 0}
            />
            <StatTile
              label="Security signals"
              value={String(kpis.securityFindings)}
              note={severityNote || undefined}
              alert={highOrWorse > 0}
            />
          </div>

          <Blueprint className="audit-section">
            <div className="card-kicker">AI Credits by day</div>
            <TrendColumns
              ariaLabel="AI Credits by day"
              axisLabel="Day"
              valueLabel="AI Credits"
              // A day with no known figure is left out, never drawn as 0 (constraint 6).
              columns={aiCreditsByDay(view.sessions, view.turns)
                .filter((day) => day.known > 0)
                .map((day) => ({
                  key: day.date,
                  label: day.date.slice(5),
                  value: day.total,
                  note: `${day.known} of ${day.count} turns known`,
                }))}
              format={(value) => value.toFixed(2)}
              selectedKeys={selections[FIELD.date] ?? []}
              onSelect={(date, additive) => select(FIELD.date, date, additive)}
              emptyText="No known AI Credits in the current selection."
            />
          </Blueprint>

          <div className="audit-grid-2">
            <Blueprint className="audit-section">
              <div className="card-kicker">Tokens by model</div>
              <HorizontalBars
                ariaLabel="Tokens by model"
                series={TOKEN_SERIES}
                rows={tokensByModel(view.turns).map((row) => ({
                  key: row.model,
                  label: row.model,
                  values: Object.fromEntries(TOKEN_KINDS.map((kind) => [kind, row[kind]])),
                }))}
                selectedKey={singleSelected(FIELD.model)}
                onSelect={(model) => select(FIELD.model, model)}
                emptyText="No turns."
              />
            </Blueprint>
            <Blueprint className="audit-section">
              <div className="card-kicker">Tool calls by tool</div>
              <HorizontalBars
                ariaLabel="Tool calls by tool"
                series={TOOL_SERIES}
                rows={toolCallsByTool(view.toolCalls)
                  .slice(0, 12)
                  .map((row) => ({ key: row.name, label: row.name, values: { succeeded: row.succeeded, failed: row.failed, unknown: row.unknown } }))}
                selectedKey={singleSelected(FIELD.tool)}
                onSelect={(tool) => select(FIELD.tool, tool)}
                emptyText="No tool calls."
              />
            </Blueprint>
            <Blueprint className="audit-section">
              <div className="card-kicker">Why calls failed</div>
              <HorizontalBars
                ariaLabel="Failures by category"
                series={FAILED_SERIES}
                rows={countBy(view.toolCalls, (call) => call.failureCategory).map((row) => ({
                  key: row.key,
                  label: CATEGORY_LABELS[row.key as FailureCategory] ?? row.key,
                  values: { failed: row.count },
                }))}
                selectedKey={singleSelected(FIELD.failureCategory)}
                onSelect={(category) => select(FIELD.failureCategory, category)}
                emptyText="No classified failures."
              />
            </Blueprint>
            <Blueprint className="audit-section">
              <div className="card-kicker">Shell programs</div>
              <HorizontalBars
                ariaLabel="Shell programs"
                series={CALLS_SERIES}
                rows={countBy(view.toolCalls, (call) => call.program)
                  .slice(0, 12)
                  .map((row) => ({ key: row.key, label: row.key, values: { calls: row.count } }))}
                selectedKey={singleSelected(FIELD.program)}
                onSelect={(program) => select(FIELD.program, program)}
                emptyText="No shell commands."
              />
            </Blueprint>
          </div>

          <Blueprint className="audit-section">
            <div className="card-kicker">Signals to review</div>
            <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
              Rule-based security signals, statistical anomalies and behaviour changes. Each is a prompt to look, not a verdict.
            </p>
            <FindingsTable
              findings={view.findings}
              sessionTitle={(key) => sessionTitles.get(key) ?? key}
              onSelectSession={(key) => select(FIELD.session, key)}
            />
          </Blueprint>

          <Blueprint className="audit-section">
            <div className="card-kicker">Most expensive sessions</div>
            <table className="table" aria-label="Most expensive sessions" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Session</th>
                  {crossProvider && <th>Provider</th>}
                  <th>Started</th>
                  <th>Turns</th>
                  <th>AI Credits</th>
                </tr>
              </thead>
              <tbody>
                {topSessionsByCredits(view.sessions, view.turns, TOP_SESSIONS).map(({ session, aiCredits, turns }) => (
                  <tr key={session.key}>
                    <td className="truncate" style={{ maxWidth: 320 }}>
                      <button type="button" className="btn btn-ghost" onClick={() => select(FIELD.session, session.key)}>
                        {session.title}
                      </button>
                    </td>
                    {crossProvider && <td>{session.providerLabel}</td>}
                    <td>{session.date ?? "—"}</td>
                    <td>{turns}</td>
                    <td>
                      {aiCredits.known > 0 ? aiCredits.total.toFixed(2) : "—"}
                      {aiCredits.known > 0 && aiCredits.known < aiCredits.count && (
                        <span className="text-muted" style={{ fontSize: 11 }}> ({aiCredits.known} of {aiCredits.count} known)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Blueprint>
          </>
        )}
      </div>
    </div>
  );
}

function ViewSwitch({ value, onChange, asSelect }: { value: DashboardView; onChange: (view: DashboardView) => void; asSelect: boolean }) {
  if (asSelect) {
    return (
      <label className="view-select">
        <span className="text-muted">View</span>
        <select className="input" aria-label="Dashboard view" value={value} onChange={(event) => onChange(event.target.value as DashboardView)}>
          {VIEW_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <div role="radiogroup" aria-label="Dashboard view" className="dashboard-views">
      <SegmentedControl name="dashboard-view" options={VIEW_OPTIONS} value={value} onChange={onChange} />
    </div>
  );
}
