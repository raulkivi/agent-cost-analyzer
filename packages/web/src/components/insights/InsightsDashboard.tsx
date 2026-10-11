import { useEffect, useMemo, useState } from "react";
import type {
  FailureCategory,
  InsightFinding,
  InsightSessionRow,
  InsightsDataset,
  InsightToolCallRow,
  InsightTurnRow,
} from "@copilot-cost-analyzer/domain";
import { fetchInsights, type InsightsQuery } from "../../api-client/insights.js";
import { HorizontalBars } from "../../charts/HorizontalBars.js";
import { TrendColumns } from "../../charts/TrendColumns.js";
import { createAssociativeEngine } from "../../lib/associative/engine.js";
import { back, clearAll, clearField, commit, emptyHistory, selectOnly, toggleValue } from "../../lib/associative/selections.js";
import { CATEGORY_LABELS, formatCompact, formatFailureRate, STATUS_META } from "../../lib/audit-format.js";
import { createInsightsModel, FIELD, LIST_BOX_GROUPS, SEVERITY_ORDER, TABLE, type FieldId } from "../../lib/insights/insights-model.js";
import {
  aiCreditsByDay,
  computeKpis,
  countBy,
  TOKEN_KINDS,
  tokensByModel,
  toolCallsByTool,
  topSessionsByCredits,
  type InsightRowsView,
} from "../../lib/insights/measures.js";
import { buildNarrative } from "../../lib/insights/narrative.js";
import { Blueprint } from "../ui/Blueprint.js";
import { SegmentedControl } from "../ui/SegmentedControl.js";
import { StatTile } from "../ui/StatTile.js";
import { CurrentSelections } from "./CurrentSelections.js";
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

const FAILED_SERIES = [{ id: "failed", label: "Failed", color: STATUS_META.error.color }];
const CALLS_SERIES = [{ id: "calls", label: "Calls", color: STATUS_META.success.color }];

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; dataset: InsightsDataset };

function queryFor(preset: RangePreset, now: Date): InsightsQuery {
  if (preset === "all") {
    return { limit: SESSIONS_PER_PROVIDER };
  }
  const since = new Date(now.getTime() - Number(preset) * 24 * 60 * 60 * 1000);
  return { since: since.toISOString().slice(0, 10), limit: SESSIONS_PER_PROVIDER };
}

interface InsightsDashboardProps {
  loadDataset?: (query: InsightsQuery) => Promise<InsightsDataset>;
  now?: Date;
}

// Phase 9.11 (docs/plans/insights-dashboard.md): a QlikView-style
// associative dashboard across every log provider — list boxes, current
// selections with Back, KPIs, clickable charts, and security/anomaly/
// behaviour-change signals that say what happened, when and why.
export function InsightsDashboard({ loadDataset = fetchInsights, now }: InsightsDashboardProps) {
  const [preset, setPreset] = useState<RangePreset>("30");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [nowTime] = useState(() => (now ?? new Date()).getTime());

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    loadDataset(queryFor(preset, new Date(nowTime)))
      .then((dataset) => !cancelled && setState({ kind: "ready", dataset }))
      .catch((error: Error) => !cancelled && setState({ kind: "error", message: error.message }));
    return () => {
      cancelled = true;
    };
  }, [preset, loadDataset, nowTime]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>Insights across all providers</h3>
        <SegmentedControl name="insights-range" options={RANGE_OPTIONS} value={preset} onChange={setPreset} />
      </div>
      {state.kind === "loading" && <p className="text-muted" style={{ fontSize: 13 }}>Loading sessions from every provider…</p>}
      {state.kind === "error" && (
        <p role="alert" style={{ fontSize: 13, color: "var(--color-accent-800)" }}>
          Could not load insights: {state.message}
        </p>
      )}
      {state.kind === "ready" && <DashboardBody dataset={state.dataset} key={state.dataset.generatedAt + preset} />}
    </div>
  );
}

function ProviderNotes({ dataset }: { dataset: InsightsDataset }) {
  const notes = dataset.providers.flatMap((provider) => {
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
  if (notes.length === 0) {
    return null;
  }
  return (
    <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
      {notes.join(" · ")}
    </p>
  );
}

function DashboardBody({ dataset }: { dataset: InsightsDataset }) {
  const model = useMemo(() => createInsightsModel(dataset), [dataset]);
  const engine = useMemo(() => createAssociativeEngine(model), [model]);
  const [history, setHistory] = useState(emptyHistory);
  const selections = history.present;
  const evaluation = useMemo(() => engine.evaluate(selections), [engine, selections]);

  if (dataset.sessions.length === 0) {
    return (
      <>
        <ProviderNotes dataset={dataset} />
        <p className="text-muted" style={{ fontSize: 13 }}>No sessions in this date range from any provider.</p>
      </>
    );
  }

  const view: InsightRowsView = {
    sessions: evaluation.rows<InsightSessionRow>(TABLE.sessions),
    turns: evaluation.rows<InsightTurnRow>(TABLE.turns),
    toolCalls: evaluation.rows<InsightToolCallRow>(TABLE.toolCalls),
    findings: evaluation.rows<InsightFinding>(TABLE.findings),
  };
  const kpis = computeKpis(view);
  const fieldsById = new Map(model.fields.map((field) => [field.id, field]));
  const fieldLabel = (fieldId: string) => fieldsById.get(fieldId)?.label ?? fieldId;
  const valueLabel = (fieldId: string, value: string) => fieldsById.get(fieldId)?.display?.(value) ?? value;
  const sessionTitles = new Map(dataset.sessions.map((session) => [session.key, session.title]));
  const singleSelected = (fieldId: FieldId) => (selections[fieldId]?.length === 1 ? selections[fieldId]![0] : undefined);

  function select(fieldId: FieldId, value: string, additive = false) {
    setHistory((current) =>
      commit(current, additive ? toggleValue(current.present, fieldId, value) : selectOnly(current.present, fieldId, value)),
    );
  }

  const severityNote = SEVERITY_ORDER.filter((severity) => kpis.findingsBySeverity[severity] > 0 && severity !== "info")
    .map((severity) => `${kpis.findingsBySeverity[severity]} ${severity}`)
    .join(", ");
  const highOrWorse = kpis.findingsBySeverity.critical + kpis.findingsBySeverity.high;

  return (
    <div className="insights-layout">
      <aside className="insights-listboxes" aria-label="Fields">
        {LIST_BOX_GROUPS.map((group) => (
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

      <div className="insights-main">
        <CurrentSelections
          selections={selections}
          fieldLabel={fieldLabel}
          valueLabel={valueLabel}
          canGoBack={history.past.length > 0}
          onClearField={(fieldId) => setHistory((current) => commit(current, clearField(current.present, fieldId)))}
          onClearAll={() => setHistory((current) => commit(current, clearAll()))}
          onBack={() => setHistory(back)}
        />
        <ProviderNotes dataset={dataset} />

        <Blueprint className="audit-section">
          <section role="region" aria-label="What happened">
            <div className="card-kicker">What happened</div>
            <ul className="insights-narrative">
              {buildNarrative(view).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        </Blueprint>

        <div className="stat-tiles">
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
                <th>Provider</th>
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
                  <td>{session.providerLabel}</td>
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
      </div>
    </div>
  );
}
