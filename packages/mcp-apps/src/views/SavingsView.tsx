// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useMemo, useRef, useState } from "react";
import type { ViewBrand } from "../brand/view-brand.js";
import type { AppHostPort, ToolResult } from "../host/app-host-port.js";
import type { ClipboardPort } from "../host/clipboard-port.js";
import { toSavingsViewModel } from "../view-models/savings.js";
import type { SavingsRowView, SavingsViewModel, SessionButtonView } from "../view-models/savings.js";
import { ErrorBox } from "./SessionCostView.js";
import { ViewShell } from "./ViewShell.js";
import { DrillDown } from "./cost-rollup/DrillDown.js";
import { useFocusOnMountIfLost } from "./focus.js";
import { ReplayDrillDown } from "./replay/ReplayDrillDown.js";
import { SavingsRow } from "./savings/SavingsRow.js";
import { parseSavingsReport } from "./savings/parse-savings.js";
import "./savings/savings.css";

// U18, savings report (docs/plans/savings-report.md §8; boards Savings.dc.html,
// SavingsStates.dc.html). Renders the get_savings_report result: the ranked
// rows per currency, the Simulated section, Not analysed. A row opens in place
// (D16); its sessions open U1 (get_session_cost) or U12 (replay_session) in
// place through the existing drill-downs, and Back returns focus to the
// session button. No message goes to the chat: the Simulated section says
// what to ask in text (D17), more rows are asked for in text too (D18), and
// there is no Cancel while loading (D20) and no Copy button (D21). Names,
// actions and reasons are logged text: plain text here, never sent anywhere.

const KICKER = "Savings";
const TITLE = "Possible savings";

interface SessionRef {
  providerId: string;
  sessionId: string;
}
interface Drill extends SessionRef {
  kind: SessionButtonView["kind"];
  model?: string | undefined;
  rowTitle: string;
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="view-section sv-section" aria-label={title}>
      <div className="view-section-head">
        <h2>{title}</h2>
        {subtitle !== undefined && <span className="text-muted">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

// Mounted again after Back, so the session button the user came from takes the
// focus the drill-down left behind (A14, D16).
function SavingsList({
  vm,
  brand,
  openKey,
  returnTo,
  onToggle,
  onOpenSession,
}: {
  vm: SavingsViewModel;
  brand: ViewBrand;
  openKey: string | undefined;
  returnTo: SessionRef | undefined;
  onToggle: (key: string) => void;
  onOpenSession: (row: SavingsRowView, session: SessionButtonView) => void;
}) {
  const focusRef = useRef<HTMLButtonElement>(null);
  useFocusOnMountIfLost(focusRef, returnTo !== undefined);
  const renderRow = (row: SavingsRowView) => (
    <SavingsRow key={row.key} row={row} open={openKey === row.key} onToggle={() => onToggle(row.key)} focusSession={openKey === row.key ? returnTo : undefined} focusRef={focusRef} onOpenSession={(session) => onOpenSession(row, session)} />
  );
  return (
    <ViewShell brand={brand} kicker={KICKER} title={TITLE}>
      <p className="text-muted sv-basis">{`${vm.periodText} · ${vm.basisText}`}</p>
      {vm.notes.map((note) => (
        <p key={note} className="text-muted sv-note">
          {note}
        </p>
      ))}
      {vm.truncationText !== undefined && <p className="sv-truncation">{vm.truncationText}</p>}
      {vm.empty !== undefined && <p className="sv-empty">{vm.empty}</p>}
      {vm.groups.map((group) => {
        const ranked = group.rows.filter((row) => row.rank !== undefined);
        const unranked = group.rows.filter((row) => row.rank === undefined);
        return (
          <Section key={group.currency} title={group.title} subtitle={group.subtitle}>
            {ranked.length > 0 && <ol className="sv-list" aria-label={`${group.title}, ranked by the high end`}>{ranked.map(renderRow)}</ol>}
            {unranked.length > 0 && <ul className="sv-list" aria-label={"Not priced, unranked"}>{unranked.map(renderRow)}</ul>}
          </Section>
        );
      })}
      <Section title="Simulated" subtitle="Replays on another model. Not ranked.">
        {vm.simulated.text !== undefined && <p className="text-muted sv-note sv-sim-off">{vm.simulated.text}</p>}
        {vm.simulated.rows.length > 0 && <ul className="sv-list" aria-label="Simulated replays, not ranked">{vm.simulated.rows.map(renderRow)}</ul>}
      </Section>
      {(vm.notAnalysed.length > 0 || vm.leftOut.length > 0) && (
        <Section title="Not analysed">
          <p className="text-muted sv-note">No row below was checked, so no saving is claimed for it.</p>
          <ul className="sv-na">
            {vm.notAnalysed.map((entry) => (
              <li key={`${entry.kindTitle}:${entry.providerLabel}:${entry.reason}`}>
                <span>
                  {entry.kindTitle} <span className="text-muted">{entry.providerLabel}</span>
                </span>
                <span className="text-muted">{entry.reason}</span>
                <span>{entry.sessionsText}</span>
              </li>
            ))}
            {vm.leftOut.map((entry) => (
              <li key={`left:${entry.providerLabel}:${entry.reason}`}>
                <span>
                  Left out of the whole report <span className="text-muted">{entry.providerLabel}</span>
                </span>
                <span className="text-muted">{entry.reason}</span>
                <span>{entry.sessionsText}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </ViewShell>
  );
}

export function SavingsView({ port, brand, clipboard, result }: { port: AppHostPort; brand: ViewBrand; clipboard?: ClipboardPort | undefined; result: ToolResult | undefined }) {
  const report = useMemo(() => (result === undefined || result.isError ? undefined : parseSavingsReport(result.structuredContent)), [result]);
  const vm = useMemo(() => (report === undefined ? undefined : toSavingsViewModel(report)), [report]);
  const [openKey, setOpenKey] = useState<string | undefined>();
  const [drill, setDrill] = useState<Drill | undefined>();
  // The session last opened, so Back can return focus to its button (D16).
  const [returnTo, setReturnTo] = useState<SessionRef | undefined>();

  if (result === undefined) {
    return (
      <ViewShell brand={brand} kicker={KICKER} title={TITLE}>
        <p role="status" className="text-muted">
          Waiting for the savings report…
        </p>
      </ViewShell>
    );
  }
  if (vm === undefined) {
    const reason = result.isError ? result.errorText?.trim() : undefined;
    return (
      <ViewShell brand={brand} kicker={KICKER} title={TITLE}>
        <ErrorBox title="Couldn't load the savings report.">{reason ? `The tool returned an error: ${reason.slice(0, 500)}` : "The tool returned an error or a result this view can't read. The text answer above is complete."}</ErrorBox>
      </ViewShell>
    );
  }
  if (drill !== undefined) {
    const back = () => setDrill(undefined);
    const trail = ["Savings", drill.rowTitle, `Session ${drill.sessionId}`];
    if (drill.kind === "replay" && drill.model !== undefined) {
      const origin = { kicker: "Savings › Session replay", backLabel: "Back to savings", trail, parent: "the savings report" };
      return <ReplayDrillDown port={port} brand={brand} target={{ sessionId: drill.sessionId, providerId: drill.providerId, model: drill.model }} onBack={back} origin={origin} />;
    }
    const origin = { kicker: "Savings › Session cost", backLabel: "Back to savings", parent: "the savings report", trail };
    return <DrillDown port={port} brand={brand} clipboard={clipboard} session={{ sessionId: drill.sessionId, providerId: drill.providerId }} onBack={back} origin={origin} />;
  }
  return (
    <SavingsList
      vm={vm}
      brand={brand}
      openKey={openKey}
      returnTo={returnTo}
      onToggle={(key) => setOpenKey((current) => (current === key ? undefined : key))}
      onOpenSession={(row, session) => {
        const ref = { providerId: session.providerId, sessionId: session.sessionId };
        setReturnTo(ref);
        setDrill({ ...ref, kind: session.kind, model: session.model, rowTitle: row.kindTitle });
      }}
    />
  );
}
