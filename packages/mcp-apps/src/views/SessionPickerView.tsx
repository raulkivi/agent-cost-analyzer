// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useMemo } from "react";
import type { ViewBrand } from "../brand/view-brand.js";
import type { AppHostPort, ToolResult } from "../host/app-host-port.js";
import { toSessionListViewModel } from "../view-models/index.js";
import { ErrorBox } from "./SessionCostView.js";
import { ViewShell } from "./ViewShell.js";
import { AnalyseRowButton } from "./cost-rollup/AskAboutSession.js";
import { parseSessionList } from "./session-picker/parse-session-list.js";
import "./session-picker/session-picker.css";

// U5, session picker (plan §4.5, board SessionPicker.dc.html): renders the
// list_sessions result. Each row has an "Analyse" button that sends exactly
// "Analyse session <id>" to the chat (owner answer Q6). A session's title is
// logged text: it is shown in the row and goes nowhere else, so the message
// never carries it (§6). A host that says it cannot send chat messages gets no
// button and the hint says what to type; a declined send puts that text in
// the row instead (Q7; owner, 2026-11-11: try, then fall back).

const KICKER = "Sessions";

export function SessionPickerView({ port, brand, result }: { port: AppHostPort; brand: ViewBrand; result: ToolResult | undefined }) {
  const list = useMemo(() => (result === undefined || result.isError ? undefined : parseSessionList(result.structuredContent)), [result]);
  const vm = useMemo(() => (list === undefined ? undefined : toSessionListViewModel(list)), [list]);

  if (result === undefined) {
    return (
      <ViewShell brand={brand} kicker={KICKER} title="Sessions">
        <p role="status" className="text-muted">
          Waiting for the session list…
        </p>
      </ViewShell>
    );
  }
  if (vm === undefined) {
    return (
      <ViewShell brand={brand} kicker={KICKER} title="Sessions">
        <ErrorBox title="Couldn't load the session list.">The tool returned an error or a result this view can't read. The text answer above is complete.</ErrorBox>
      </ViewShell>
    );
  }

  const canSend = port.canSendMessage();
  return (
    <ViewShell brand={brand} kicker={KICKER} title="Sessions" meta={vm.summaryText}>
      {vm.empty !== undefined ? (
        <div className="sp-empty">
          <b>{vm.empty.title}</b>
          <p className="text-muted">{vm.empty.hint}</p>
        </div>
      ) : (
        <>
          <ul className="sp-list" aria-label="Sessions">
            {vm.rows.map((row) => (
              <li key={row.sessionId} className="sp-row">
                <div className="sp-main">
                  <span className="sp-title" title={row.title}>
                    {row.title}
                  </span>
                  <span className="sp-meta text-muted">
                    <span className="sp-id">{row.shortId}</span>
                    {row.startedText !== undefined && <span>{row.startedText}</span>}
                    <span>{row.turnsText}</span>
                    <span>{row.model}</span>
                    {row.repository !== undefined && <span className="sp-repo">{row.repository}</span>}
                  </span>
                </div>
                {canSend && (
                  <div className="sp-action">
                    <AnalyseRowButton port={port} sessionId={row.sessionId} shortId={row.shortId} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          {canSend ? (
            <p className="sp-hint text-muted">
              A click sends only <code className="inline-code">Analyse session &lt;id&gt;</code> to the chat. Titles and other session text are never sent.
            </p>
          ) : (
            <p className="sp-hint text-muted">
              Ask in the chat: <code className="inline-code">Analyse session &lt;id&gt;</code>
            </p>
          )}
        </>
      )}
    </ViewShell>
  );
}
