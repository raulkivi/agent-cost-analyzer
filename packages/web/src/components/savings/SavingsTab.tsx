// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { PricingMode, SavingsOpportunity, SavingsReport, SavingsSessionRef } from "@agent-cost-analyzer/domain";
import { fetchSavingsReport, type SavingsQuery } from "../../api-client/savings.js";
import { getHostCapabilities } from "../../host/current-host-capabilities.js";
import { CURRENCY_TITLES, groupByCurrency, KIND_TITLES, type CurrencyGroup } from "../../lib/savings/savings-view.js";
import { useCancellableLoad } from "../../lib/use-cancellable-load.js";
import { useContainerWidth } from "../../lib/use-container-width.js";
import { AsyncView } from "../ui/AsyncView.js";
import { SavingsDetail } from "./SavingsDetail.js";
import { SavingsRow } from "./SavingsRow.js";

// Phase 16 SR14 (docs/plans/savings-report.md §5.3, §7; boards in
// docs/plans/mockups/savings-report): the Savings tab, shared by the
// standalone app (a Dashboard view) and the extension panel. One ranked list
// per currency, never converted and never added up; the Simulated section
// apart and unranked; what was not analysed, with reasons; sessions left out
// as partial data. Read-only: Copy and the links into the session view are
// the only actions.

const WINDOW_DAYS = [7, 30, 90] as const;
const DEFAULT_DAYS = 30;
// Below this width the detail replaces the list (board Narrow, 320 px).
const NARROW_BELOW = 600;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SavingsProviderOption {
  id: string;
  label: string;
}

interface SavingsTabProps {
  loadReport?: (query: SavingsQuery, signal: AbortSignal) => Promise<SavingsReport>;
  copyToClipboard?: (text: string) => Promise<void>;
  now?: Date;
  // The providers of the Provider filter (the standalone app); labels name them in rows.
  providers?: readonly SavingsProviderOption[];
  // The extension reads GitHub Copilot sessions only: no Provider filter, and a pointer to the app.
  copilotOnly?: boolean;
  // Per host: "Open in Analyze" in the app, "Open session" in the extension.
  openSessionLabel?: string;
  onOpenSession?: (session: SavingsSessionRef) => void;
}

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const formatDate = (iso: string) => DATE.format(new Date(`${iso}T00:00:00Z`));

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function windowNote(report: SavingsReport, copilotOnly: boolean): string {
  const { since, until, days } = report.window;
  const weeks = (days / 7).toFixed(1);
  return (
    `${formatDate(since)} – ${formatDate(until)}, ${days} days. Amounts are per week (${days} days ÷ ${weeks}). ` +
    "Changes are ranked by the high end; the low end sits beside it. Opportunities overlap, so they are not added up." +
    (copilotOnly ? " Claude Code and pi savings are in the standalone app." : "")
  );
}

export function SavingsTab({
  loadReport = fetchSavingsReport,
  copyToClipboard = (text) => getHostCapabilities().copyToClipboard(text),
  now,
  providers = [],
  copilotOnly = false,
  openSessionLabel = "Open in Analyze",
  onOpenSession,
}: SavingsTabProps) {
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [provider, setProvider] = useState("");
  const [pricing, setPricing] = useState<PricingMode>("as-of-use");
  // Off by default in both products: a replay per session is the slow part.
  const [includeSimulated, setIncludeSimulated] = useState(false);
  const clock = useRef(now ?? new Date());
  const ids = { days: useId(), provider: useId(), pricing: useId() };

  const query = useMemo<SavingsQuery>(
    () => ({
      since: new Date(clock.current.getTime() - days * DAY_MS).toISOString().slice(0, 10),
      ...(provider === "" ? {} : { provider }),
      pricing,
      includeSimulated,
    }),
    [days, provider, pricing, includeSimulated],
  );
  const load = useCallback((signal: AbortSignal) => loadReport(query, signal), [loadReport, query]);
  const { state, cancel, retry } = useCancellableLoad(load);

  const providerLabel = useCallback((id: string) => providers.find((option) => option.id === id)?.label ?? id, [providers]);
  const report = state.kind === "ready" ? state.data : undefined;
  const nothingFound = report !== undefined && report.opportunities.length === 0 && report.simulated.length === 0;
  const nothingAtAll = nothingFound && report.notAnalysed.length === 0 && (report.sessionsLeftOut?.length ?? 0) === 0;

  const leftOutNote = report?.sessionsLeftOut?.length
    ? report.sessionsLeftOut.map((entry) => `${pluralize(entry.sessions, "session")} of ${providerLabel(entry.providerId)} left out: ${entry.reason}.`).join(" ")
    : undefined;

  const status = state.kind === "loading" ? "loading" : state.kind === "error" ? "error" : state.kind === "cancelled" || nothingAtAll ? "empty" : "ready";
  const empty =
    state.kind === "cancelled"
      ? {
          title: "Cancelled",
          body: "Nothing is shown, because a partial list would misrank the changes. Nothing was changed: this view only reads your logs.",
          action: { label: "Run again", onClick: retry },
        }
      : {
          title: `Nothing to report in the last ${report?.window.days ?? days} days`,
          body: "Either no session in this window had a change to suggest, or there were no sessions. Widen the window, or choose another provider.",
          ...((report?.window.days ?? days) < 90 ? { action: { label: "Use 90 days", onClick: () => setDays(90) } } : {}),
        };

  return (
    <div className="savings-tab" data-testid="savings-tab">
      <div className="savings-filters" role="group" aria-label="Savings filters">
        <label className="savings-filter" htmlFor={ids.days}>
          <span className="text-muted">Window</span>
          <select id={ids.days} className="input" value={days} onChange={(event) => setDays(Number(event.target.value))}>
            {WINDOW_DAYS.map((option) => (
              <option key={option} value={option}>{`Last ${option} days`}</option>
            ))}
          </select>
        </label>
        {copilotOnly ? (
          <span className="savings-scope">GitHub Copilot sessions only</span>
        ) : (
          <label className="savings-filter" htmlFor={ids.provider}>
            <span className="text-muted">Provider</span>
            <select id={ids.provider} className="input" value={provider} onChange={(event) => setProvider(event.target.value)}>
              <option value="">All providers</option>
              {providers.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="savings-filter" htmlFor={ids.pricing}>
          <span className="text-muted">Prices</span>
          <select id={ids.pricing} className="input" value={pricing} onChange={(event) => setPricing(event.target.value as PricingMode)}>
            <option value="as-of-use">As of use</option>
            <option value="today">Today&apos;s prices</option>
          </select>
        </label>
        <label className="savings-filter savings-check">
          <input type="checkbox" checked={includeSimulated} onChange={(event) => setIncludeSimulated(event.target.checked)} />
          Include simulated
        </label>
        <button type="button" className="btn btn-secondary" onClick={retry}>
          Refresh
        </button>
      </div>

      <AsyncView
        status={status}
        loadingText="Building the savings report…"
        readyText="Savings report ready"
        skeleton="list"
        onCancel={cancel}
        empty={empty}
        error={{ title: "Could not build the report.", details: state.kind === "error" ? state.message : undefined, onRetry: retry }}
        partial={leftOutNote}
        copyToClipboard={copyToClipboard}
      >
        {report && (
          <SavingsReportView
            report={report}
            copilotOnly={copilotOnly}
            nothingFound={nothingFound}
            providerLabel={providerLabel}
            openSessionLabel={openSessionLabel}
            {...(onOpenSession ? { onOpenSession } : {})}
            copyToClipboard={copyToClipboard}
          />
        )}
      </AsyncView>
    </div>
  );
}

interface SavingsReportViewProps {
  report: SavingsReport;
  copilotOnly: boolean;
  nothingFound: boolean;
  providerLabel: (providerId: string) => string;
  openSessionLabel: string;
  onOpenSession?: (session: SavingsSessionRef) => void;
  copyToClipboard: (text: string) => Promise<void>;
}

function groupTitle(group: CurrencyGroup, providerLabel: (id: string) => string): string {
  const priced = group.rows.length - group.unpriced;
  const parts = [`${pluralize(group.rows.length, "change")}`];
  if (priced === 0) parts.push("none priced");
  else if (group.unpriced > 0) parts.push(`${group.unpriced} not priced`);
  return `${group.providerIds.map(providerLabel).join(", ")} · ${parts.join(", ")}`;
}

function SavingsReportView({ report, copilotOnly, nothingFound, providerLabel, openSessionLabel, onOpenSession, copyToClipboard }: SavingsReportViewProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [restoreFocus, setRestoreFocus] = useState<string | null>(null);
  const [measure, width] = useContainerWidth<HTMLDivElement>();
  const buttons = useRef(new Map<string, HTMLButtonElement | null>());
  const narrow = width !== undefined && width > 0 && width < NARROW_BELOW;

  const groups = useMemo(() => groupByCurrency(report.opportunities), [report.opportunities]);
  const everything = useMemo<SavingsOpportunity[]>(() => [...report.opportunities, ...report.simulated], [report]);
  const selected = selectedKey === null ? undefined : everything.find((opportunity) => opportunity.key === selectedKey);
  const allUnknown = report.opportunities.length > 0 && report.opportunities.every((opportunity) => !opportunity.perWeek.known);
  const simulatedMax = Math.max(0, ...report.simulated.map((opportunity) => (opportunity.perWeek.known ? opportunity.perWeek.high : 0)));

  useEffect(() => {
    if (restoreFocus === null || selected !== undefined) return;
    buttons.current.get(restoreFocus)?.focus();
    setRestoreFocus(null);
  }, [restoreFocus, selected]);

  function close(): void {
    setRestoreFocus(selectedKey);
    setSelectedKey(null);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && selected !== undefined) close();
  }

  const rowRef = (key: string) => (element: HTMLButtonElement | null) => {
    buttons.current.set(key, element);
  };

  const list = (
    <div className="savings-lists">
      <p className="text-muted">{windowNote(report, copilotOnly)}</p>
      {allUnknown && (
        <p className="savings-note" role="note">
          No price in the price book for the models in these sessions, so no amount is claimed. The counts are real; the amounts are not zero, they are unknown.
        </p>
      )}
      {nothingFound && (
        <div className="async-empty">
          <h4 style={{ margin: 0 }}>Nothing found in the analysed sessions</h4>
          <div className="text-muted async-empty-body">None of the checks found a cost worth acting on. Sessions that were not analysed are listed below.</div>
        </div>
      )}
      {groups.map((group) => {
        const title = CURRENCY_TITLES[group.currency];
        return (
          <section key={group.currency} aria-labelledby={`savings-group-${group.currency}`} className="savings-group">
            <div className="savings-group-head">
              <h3 id={`savings-group-${group.currency}`}>{title}</h3>
              <span className="text-muted">{groupTitle(group, providerLabel)}</span>
            </div>
            <p className="text-muted savings-bar-caption">Bars compare rows in this list only.</p>
            <ul className="savings-list" aria-label={title}>
              {group.rows.map((row) => (
                <SavingsRow
                  key={row.key}
                  opportunity={row.opportunity}
                  rank={row.rank}
                  maxHigh={group.maxHigh}
                  selected={row.key === selectedKey}
                  onSelect={() => setSelectedKey(row.key)}
                  buttonRef={rowRef(row.key)}
                />
              ))}
            </ul>
          </section>
        );
      })}
      {report.simulated.length > 0 && (
        <section aria-labelledby="savings-simulated" className="savings-group">
          <div className="savings-group-head">
            <h3 id="savings-simulated">Simulated</h3>
            <span className="text-muted">Replays on another model. Not ranked.</span>
          </div>
          <ul className="savings-list" aria-label="Simulated savings">
            {report.simulated.map((opportunity) => (
              <SavingsRow
                key={opportunity.key}
                opportunity={opportunity}
                maxHigh={simulatedMax}
                selected={opportunity.key === selectedKey}
                onSelect={() => setSelectedKey(opportunity.key)}
                buttonRef={rowRef(opportunity.key)}
              />
            ))}
          </ul>
        </section>
      )}
      {report.notAnalysed.length > 0 && (
        <section aria-labelledby="savings-not-analysed" className="savings-group">
          <div className="savings-group-head">
            <h3 id="savings-not-analysed">Not analysed</h3>
            <span className="text-muted">No row below was checked, so no saving is claimed for it.</span>
          </div>
          <ul className="savings-list" aria-label="Not analysed">
            {report.notAnalysed.map((entry) => (
              <li key={`${entry.kind}/${entry.providerId}/${entry.reason}`} className="savings-row savings-not-analysed">
                <span className="savings-row-title">{KIND_TITLES[entry.kind]}</span>
                <span>{providerLabel(entry.providerId)}</span>
                <span className="text-muted">{entry.reason}</span>
                <span>{pluralize(entry.sessions, "session")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );

  const detail =
    selected === undefined ? null : (
      <SavingsDetail
        key={selected.key}
        opportunity={selected}
        days={report.window.days}
        providerLabel={providerLabel}
        openSessionLabel={openSessionLabel}
        {...(onOpenSession ? { onOpenSession } : {})}
        copyToClipboard={copyToClipboard}
        onClose={close}
        closeLabel={narrow ? "Back to the list" : "Close detail"}
      />
    );

  return (
    // Escape closes the detail from anywhere inside the report.
    <div className={detail && !narrow ? "savings-body savings-body--split" : "savings-body"} ref={measure} onKeyDown={onKeyDown}>
      {narrow && detail ? detail : list}
      {!narrow && detail}
    </div>
  );
}
