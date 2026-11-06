import { useCallback, useId, useMemo, useRef, useState } from "react";
import {
  channelLabel,
  exportStatement,
  parseStatementPeriod,
  type Statement,
  type StatementAnswer,
  type StatementExportFormat,
} from "@agent-cost-analyzer/domain";
import { fetchStatement, issueStatement, type StatementQuery } from "../../api-client/statements.js";
import { standaloneHostCapabilities } from "../../host/host-capabilities.js";
import { useEscapeKey, useFocusTrap } from "../../lib/focus.js";
import { useCancellableLoad } from "../../lib/use-cancellable-load.js";
import { AsyncView, cancelledEmptyState } from "../ui/AsyncView.js";
import { Blueprint } from "../ui/Blueprint.js";

// Phase 15 step 15.11 (plan §8.5, §11.5; board 4): the Dashboard's Billing
// tab. One project and period: the draft statement with exact dates (a bill
// needs them), Issue behind a confirmation dialog because it writes a file,
// Export with a format choice, a preview and Copy or Save, and the frozen
// copy tagged "Frozen" with "Differs from issued" and its exact diff when a
// re-run changed. Unknown cost is listed, never 0. With no projects, it says
// how to start and opens the Projects editor.

interface BillingTabProps {
  projects: readonly { id: string; name: string }[];
  selections: Readonly<Record<string, readonly string[]>>;
  now: Date;
  onEditProjects: () => void;
  loadStatement?: (query: StatementQuery, signal: AbortSignal) => Promise<StatementAnswer>;
  issue?: (projectId: string, period: string) => Promise<StatementAnswer>;
  copyToClipboard?: (text: string) => Promise<void>;
}

const unit = (currency: string) => (currency === "AI_CREDITS" ? "AI Credits" : currency);
const fixed2 = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (value: number) => (value > 0 ? `+${fixed2(value)}` : value < 0 ? `−${fixed2(-value)}` : fixed2(0));

// The last 12 calendar months up to this one; the last ended month first chosen.
function monthOptions(now: Date): { value: string; label: string }[] {
  const months: { value: string; label: string }[] = [];
  for (let back = 0; back < 12; back += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const value = date.toISOString().slice(0, 7);
    months.push({ value, label: parseStatementPeriod(value, "UTC")!.label });
  }
  return months;
}

export function BillingTab({ projects, selections, now, onEditProjects, loadStatement = fetchStatement, issue = issueStatement, copyToClipboard = standaloneHostCapabilities().copyToClipboard }: BillingTabProps) {
  const months = useMemo(() => monthOptions(now), [now]);
  const selected = selections.project?.length === 1 ? selections.project[0] : undefined;
  const [projectId, setProjectId] = useState(() => projects.find((project) => project.id === selected)?.id ?? projects[0]?.id ?? "");
  const [period, setPeriod] = useState(months[1]?.value ?? months[0]!.value);
  const [reload, setReload] = useState(0);
  const ready = projects.length > 0 && projectId !== "";

  // `reload` changes after issuing, so the statement is read again.
  const load = useCallback((signal: AbortSignal) => (void reload, loadStatement({ projectId, period }, signal)), [projectId, period, loadStatement, reload]);
  const { state, cancel, retry } = useCancellableLoad(load, ready);

  if (projects.length === 0) {
    return (
      <div className="cost-tab">
        <AsyncView status="empty" loadingText="" empty={{ title: "Group repositories into a project to bill and compare them.", body: "A project groups repositories; its statements bill their cost.", action: { label: "Create project", onClick: onEditProjects } }}>
          {null}
        </AsyncView>
      </div>
    );
  }

  return (
    <div className="cost-tab">
      <div className="cost-filters" role="group" aria-label="Statement">
        <label className="cost-filter view-select">
          <span className="text-muted">Project</span>
          <select className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label className="cost-filter view-select">
          <span className="text-muted">Period</span>
          <select className="input" value={period} onChange={(event) => setPeriod(event.target.value)}>
            {months.map((month) => (
              <option key={month.value} value={month.value}>
                {month.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-secondary" onClick={onEditProjects}>
          Edit projects
        </button>
      </div>
      <AsyncView
        status={state.kind === "ready" ? "ready" : state.kind === "cancelled" ? "empty" : state.kind}
        loadingText="Loading the statement…"
        readyText="Statement loaded."
        skeleton="table"
        onCancel={cancel}
        error={state.kind === "error" ? { title: `Could not load the statement: ${state.message}`, onRetry: retry } : undefined}
        empty={cancelledEmptyState(retry)}
      >
        {state.kind === "ready" && (
          <StatementView
            answer={state.data}
            copyToClipboard={copyToClipboard}
            onPickPeriod={setPeriod}
            onIssue={async () => {
              await issue(projectId, period);
              setReload((n) => n + 1);
            }}
          />
        )}
      </AsyncView>
    </div>
  );
}

interface StatementViewProps {
  answer: StatementAnswer;
  copyToClipboard: (text: string) => Promise<void>;
  onPickPeriod: (period: string) => void;
  onIssue: () => Promise<void>;
}

function StatementView({ answer, copyToClipboard, onPickPeriod, onIssue }: StatementViewProps) {
  const { statement } = answer;
  const [dialog, setDialog] = useState<"issue" | "export" | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const frozen = statement.status === "issued";
  const differs = answer.diff?.changed === true;
  const titleId = useId();

  return (
    <div className="billing-grid">
      <Blueprint className="audit-section">
        <section aria-labelledby={titleId}>
          <div className="billing-head">
            <div>
              {frozen && <span className="tag">Frozen</span>}
              <h4 id={titleId} className="cost-chart-title">
                {statement.project.name} · {statement.period.since} to {statement.period.until} ({statement.period.timeZone})
              </h4>
              <div className="text-muted">
                {[statement.project.client && `Client: ${statement.project.client}`, statement.project.billingCode && `Billing code: ${statement.project.billingCode}`, frozen ? `Issued ${statement.issuedAt}` : "Draft"].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className="billing-actions">
              <button type="button" className="btn btn-secondary" aria-haspopup="dialog" onClick={() => setDialog("export")}>
                Export…
              </button>
              {frozen && differs && (
                <button type="button" className="btn btn-secondary" aria-expanded={showDiff} onClick={() => setShowDiff((open) => !open)}>
                  View diff
                </button>
              )}
              {answer.canIssue.ok && (
                <button type="button" className="btn btn-primary" aria-haspopup="dialog" onClick={() => setDialog("issue")}>
                  Issue statement
                </button>
              )}
            </div>
          </div>
          {!answer.canIssue.ok && !frozen && <p className="text-muted cost-note">{answer.canIssue.reason}</p>}
          {issueError && (
            <p role="alert" className="cost-note">
              Not issued: {issueError}. Nothing was changed.
            </p>
          )}
          {frozen && differs && (
            <p role="status" className="cost-note billing-differs">
              <span className="status-tag">
                <span aria-hidden="true">⚠</span> Differs from issued
              </span>{" "}
              A re-run today gives other figures (late logs or a price-book change). The issued statement stays as it was.
            </p>
          )}
          {showDiff && answer.diff && <DiffTable diff={answer.diff} />}
          <StatementTables statement={statement} />
        </section>
      </Blueprint>
      <Blueprint className="audit-section">
        <h4 className="cost-chart-title">Issued statements</h4>
        {answer.issuedPeriods.length === 0 ? (
          <p className="text-muted cost-note">None yet for this project.</p>
        ) : (
          <ul aria-label="Issued statements" className="billing-issued">
            {answer.issuedPeriods.map((key) => (
              <li key={key}>
                <button type="button" className="btn btn-ghost" onClick={() => onPickPeriod(key.includes("_") ? key.replace("_", "..") : key)}>
                  {parseStatementPeriod(key.includes("_") ? key.replace("_", "..") : key, "UTC")?.label ?? key}
                </button>{" "}
                <span className="tag">Frozen</span>
              </li>
            ))}
          </ul>
        )}
      </Blueprint>
      {dialog === "issue" && (
        <IssueDialog
          statement={statement}
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            setDialog(null);
            try {
              setIssueError(null);
              await onIssue();
            } catch (error) {
              setIssueError(error instanceof Error ? error.message : String(error));
            }
          }}
        />
      )}
      {dialog === "export" && <ExportDialog statement={statement} copyToClipboard={copyToClipboard} onClose={() => setDialog(null)} />}
    </div>
  );
}

function StatementTables({ statement }: { statement: Statement }) {
  const tokensOf = (line: Statement["lines"][number]) => {
    const values = Object.values(line.tokens);
    return values.every((value) => value === null) ? "unknown" : values.reduce<number>((sum, value) => sum + (value ?? 0), 0).toLocaleString("en-US");
  };
  return (
    <>
      <div className="table-scroll">
        <table className="table">
          <caption className="sr-only">Statement lines by channel, model and price version</caption>
          <thead>
            <tr>
              <th scope="col">Channel</th>
              <th scope="col">Model</th>
              <th scope="col">Price version</th>
              <th scope="col">Basis</th>
              <th scope="col" className="num">
                Turns
              </th>
              <th scope="col" className="num">
                Tokens
              </th>
              <th scope="col" className="num">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {statement.lines.map((line) => (
              <tr key={line.key}>
                <td>{line.channel ? channelLabel(line.channel) : "unknown channel"}</td>
                <td>{line.model}</td>
                <td>{line.priceVersionId ?? "—"}</td>
                <td>
                  {line.basis}
                  {line.apiEquivalent ? " (API-equivalent)" : ""}
                </td>
                <td className="num">{line.turns}</td>
                <td className="num">{tokensOf(line)}</td>
                <td className="num">
                  {fixed2(line.amount)} {unit(line.currency)}
                </td>
              </tr>
            ))}
            {statement.unknown.map((line) => (
              <tr key={`unknown-${line.reason}`}>
                <td colSpan={7}>
                  <strong>
                    {line.turns} {line.turns === 1 ? "turn" : "turns"}, cost unknown:
                  </strong>{" "}
                  {line.reason}. Not counted as 0.
                </td>
              </tr>
            ))}
            {statement.lines.length + statement.unknown.length === 0 && (
              <tr>
                <td colSpan={7} className="text-muted">
                  No turns in this project and period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="table-scroll">
        <table className="table">
          <caption className="sr-only">Totals</caption>
          <thead>
            <tr>
              <th scope="col">Currency</th>
              <th scope="col" className="num">
                Lines
              </th>
              <th scope="col" className="num">
                Markup{statement.markupPercent !== undefined ? ` (${statement.markupPercent}%)` : ""}
              </th>
              <th scope="col" className="num">
                Fixed
              </th>
              <th scope="col" className="num">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {statement.totals.map((total) => (
              <tr key={total.currency}>
                <th scope="row">{unit(total.currency)}</th>
                <td className="num">{fixed2(total.lines)}</td>
                <td className="num">{fixed2(total.markup)}</td>
                <td className="num">{fixed2(total.fixed)}</td>
                <td className="num">
                  <strong>{fixed2(total.total)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {statement.fixedLines.length > 0 && <p className="text-muted cost-note">Fixed lines: {statement.fixedLines.map((line) => `${line.label} ${fixed2(line.amount)} ${unit(line.currency)}`).join("; ")}.</p>}
      {statement.userCurrency && (
        <p className="cost-note">
          In all: {statement.userCurrency.code} {fixed2(statement.userCurrency.total)} ({statement.userCurrency.conversion})
        </p>
      )}
      {statement.excluded.map((line) => (
        <p key={line.reason} className="text-muted cost-note">
          Not included: {line.turns} {line.turns === 1 ? "turn" : "turns"} of {line.reason}.
        </p>
      ))}
      <p className="text-muted cost-note">
        Coverage: {statement.coverage.knownTurns} of {statement.coverage.turns} turns have a known cost. {statement.conversion}
      </p>
      <details>
        <summary>Provenance</summary>
        <p className="text-muted cost-note">
          App {statement.provenance.appVersion} · price book {statement.provenance.priceBookHash} · projects file {statement.provenance.projectsFileHash} · {statement.provenance.sessions.length} session ids (in the JSON export) · generated {statement.generatedAt}
        </p>
      </details>
    </>
  );
}

function DiffTable({ diff }: { diff: NonNullable<StatementAnswer["diff"]> }) {
  return (
    <div className="table-scroll">
      <table className="table">
        <caption>Differences from the issued statement</caption>
        <thead>
          <tr>
            <th scope="col">What</th>
            <th scope="col" className="num">
              Issued
            </th>
            <th scope="col" className="num">
              Re-run
            </th>
            <th scope="col" className="num">
              Difference
            </th>
          </tr>
        </thead>
        <tbody>
          {diff.totals.map((total) => (
            <tr key={total.currency}>
              <th scope="row">Total, {unit(total.currency)}</th>
              <td className="num">{fixed2(total.issued)}</td>
              <td className="num">{fixed2(total.current)}</td>
              <td className="num">{signed(total.difference)}</td>
            </tr>
          ))}
          {diff.lines.map((line) => (
            <tr key={line.key}>
              <th scope="row">
                {line.change}: {line.key.split("|").filter(Boolean).join(" · ")}
              </th>
              <td className="num">{line.issued === null ? "—" : fixed2(line.issued)}</td>
              <td className="num">{line.current === null ? "—" : fixed2(line.current)}</td>
              <td className="num">{signed(line.difference)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted cost-note">
        {diff.sessions.added.length} sessions added, {diff.sessions.removed.length} removed; unknown-cost turns {diff.unknownTurns.issued} then {diff.unknownTurns.current}.
        {diff.inputs.priceBookChanged ? " The price book changed." : ""}
        {diff.inputs.projectsFileChanged ? " The projects file changed." : ""}
      </p>
    </div>
  );
}

function IssueDialog({ statement, onCancel, onConfirm }: { statement: Statement; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useFocusTrap(dialog);
  useEscapeKey(onCancel);
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div ref={dialog} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} onClick={(event) => event.stopPropagation()}>
        <div id={titleId} className="dialog-title">
          Issue the {statement.period.label} statement?
        </div>
        <div id={bodyId} className="dialog-body">
          <p>
            This writes the statement for {statement.project.name}, {statement.period.since} to {statement.period.until}, to a file in the app's settings folder. An issued statement never changes: later
            logs or price-book changes show as a diff beside it.
          </p>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            Issue statement
          </button>
        </div>
      </div>
    </div>
  );
}

const FORMATS: { value: StatementExportFormat; label: string; extension: string; type: string }[] = [
  { value: "csv", label: "CSV", extension: "csv", type: "text/csv" },
  { value: "json", label: "JSON", extension: "json", type: "application/json" },
  { value: "markdown", label: "Markdown", extension: "md", type: "text/markdown" },
];

function ExportDialog({ statement, copyToClipboard, onClose }: { statement: Statement; copyToClipboard: (text: string) => Promise<void>; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const previewId = useId();
  const [format, setFormat] = useState<StatementExportFormat>("csv");
  const [includeTitles, setIncludeTitles] = useState(true);
  const [copied, setCopied] = useState(false);
  useFocusTrap(dialog);
  useEscapeKey(onClose);
  const text = exportStatement(statement, format, { includeTitles });
  const chosen = FORMATS.find((entry) => entry.value === format)!;
  const fileName = `${statement.project.id}-${statement.period.key}.${chosen.extension}`;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div ref={dialog} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ maxWidth: 720 }} onClick={(event) => event.stopPropagation()}>
        <div id={titleId} className="dialog-title">
          Export · {statement.project.name}, {statement.period.label}
        </div>
        <div className="dialog-body">
          <div role="radiogroup" aria-label="Format" className="billing-formats">
            {FORMATS.map((entry) => (
              <label key={entry.value} className="checkbox">
                <input type="radio" name="statement-format" checked={format === entry.value} onChange={() => (setFormat(entry.value), setCopied(false))} />
                {entry.label}
              </label>
            ))}
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={includeTitles} onChange={(event) => (setIncludeTitles(event.target.checked), setCopied(false))} />
            Include session titles
          </label>
          <p className="text-muted cost-note">Session ids and titles only; message text is never exported.</p>
          <label htmlFor={previewId} className="text-muted">
            Preview
          </label>
          <textarea id={previewId} className="input billing-preview" readOnly value={text} rows={12} />
        </div>
        <div className="dialog-actions">
          <span role="status" className="text-muted">
            {copied ? "Copied." : ""}
          </span>
          <button type="button" className="btn btn-secondary" onClick={() => void copyToClipboard(text).then(() => setCopied(true))}>
            Copy
          </button>
          <a className="btn btn-secondary" download={fileName} href={`data:${chosen.type};charset=utf-8,${encodeURIComponent(text)}`}>
            Save {fileName}
          </a>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
