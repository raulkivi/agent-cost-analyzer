// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useId, useRef, useState } from "react";
import type { AppHostPort } from "../../host/app-host-port.js";
import { Tag } from "@agent-cost-analyzer/web/ui/Tag";
import { toTurnDetailViewModel } from "../../view-models/index.js";
import type { MeasureView, TopTurnRow, TurnDetailViewModel } from "../../view-models/index.js";
import { callParsed, parseTurnView, useResource } from "./tool-data.js";

// Top turns by the server's ranking (AI Credits or input tokens). A row opens its turn inline: get_turn through the
// port, the same tool the model can call (plan §4.3, §4.5). Logged text in
// the excerpt and the detail is shown here and goes nowhere else (§6).

function Figure({ value }: { value: MeasureView }) {
  return <span className={value.known ? undefined : "view-unknown"}>{value.text}</span>;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={open ? "view-chevron view-chevron--open" : "view-chevron"}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function TurnDetail({ detail, onHide }: { detail: TurnDetailViewModel; onHide: () => void }) {
  return (
    <div className="view-turn-detail">
      <div className="view-turn-detail-head">
        <span className="card-kicker">{detail.heading}</span>
        <button type="button" className="view-link" onClick={onHide}>
          Hide turn
        </button>
      </div>
      {detail.eventText !== undefined && <div className="view-turn-event">{detail.eventText}</div>}
      <div className="view-turn-grid">
        <div>
          <span className="view-label">Prompt (excerpt)</span>
          {"unavailable" in detail.prompt ? (
            <p className="view-turn-prompt">
              <span className="view-unknown">Unknown</span> <span className="text-muted">{detail.prompt.unavailable}</span>
            </p>
          ) : (
            <p className="view-turn-prompt">
              {detail.prompt.text}
              {detail.prompt.truncated ? "…" : ""}
            </p>
          )}
        </div>
        <div>
          <span className="view-label">Tokens</span>
          <dl className="view-turn-tokens">
            {detail.tokens.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>
                  <Figure value={row.value} />
                  {row.value.estimate && <Tag variant="outline" className="view-estimate">estimate</Tag>}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <div className="view-turn-tools">
        <span className="view-label">Tool calls</span> <span className={detail.toolCalls.count === "Unknown" ? "view-unknown" : undefined}>{detail.toolCalls.count}</span>
        {detail.toolCalls.summary && <span className="text-muted"> · {detail.toolCalls.summary}</span>}
        {detail.toolCalls.failed > 0 && <span className="text-muted"> · {detail.toolCalls.failed} failed</span>}
      </div>
    </div>
  );
}

function TurnRow({ port, sessionId, provider, turn, open, onToggle }: { port: AppHostPort; sessionId: string; provider: string | undefined; turn: TopTurnRow; open: boolean; onToggle: () => void }) {
  const { state, load } = useResource(
    () => callParsed(port, "get_turn", { sessionId, turnIndex: turn.turnIndex, ...(provider === undefined ? {} : { provider }) }, parseTurnView),
    false,
    `${sessionId}:${turn.turnIndex}`,
  );

  const detailId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const toggle = () => {
    if (!open && state.status === "idle") load();
    onToggle();
  };
  // "Hide turn" removes itself, so focus goes back to the row's toggle
  // rather than falling to the document (A14).
  const hide = () => {
    onToggle();
    toggleRef.current?.focus();
  };

  return (
    <>
      <tr className={open ? "view-row-selected" : undefined}>
        <td className="view-left">
          <button ref={toggleRef} type="button" className="view-row-button" aria-expanded={open} aria-controls={open ? detailId : undefined} aria-label={`Turn ${turn.turnIndex}`} onClick={toggle}>
            <Chevron open={open} />
            <span>{turn.turnIndex}</span>
          </button>
        </td>
        <td className="view-cell-text">
          {turn.excerptRecorded ? turn.excerpt : <span className="view-unknown">{turn.excerpt}</span>}
          {turn.eventLabel !== undefined && (
            <>
              {" "}
              <Tag variant="neutral">{turn.eventLabel}</Tag>
            </>
          )}
        </td>
        <td>
          <Figure value={turn.aiCredits} />
        </td>
        <td>
          <Figure value={turn.inputTokens} />
        </td>
      </tr>
      {open && (
        <tr id={detailId} className="view-row-detail">
          <td colSpan={4}>
            {state.status === "loading" && (
              <p role="status" className="text-muted">
                Loading turn {turn.turnIndex}…
              </p>
            )}
            {state.status === "error" && (
              <div className="view-error" role="alert">
                <div>
                  <b>Couldn&apos;t load turn {turn.turnIndex}.</b> <span>The get_turn call failed. The figures in the table still stand.</span>
                  <div className="view-error-action">
                    <button type="button" className="btn btn-secondary view-btn" onClick={load}>
                      Retry
                    </button>
                  </div>
                </div>
              </div>
            )}
            {state.status === "ready" && <TurnDetail detail={toTurnDetailViewModel(state.data)} onHide={hide} />}
          </td>
        </tr>
      )}
    </>
  );
}


export function TopTurns({ port, sessionId, provider, turns, rankingLabel }: { port: AppHostPort; sessionId: string; provider: string | undefined; turns: TopTurnRow[]; rankingLabel: string }) {
  const [openTurns, setOpenTurns] = useState<ReadonlySet<number>>(new Set());
  if (turns.length === 0) return <p className="text-muted">No turns.</p>;
  const toggle = (index: number) =>
    setOpenTurns((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  return (
    <div className="view-scroll" tabIndex={0} role="region" aria-label="Top turns, scrollable">
      <table className="view-table" aria-label={`Top turns by ${rankingLabel}`}>
        <thead>
          <tr>
            <th className="view-left">#</th>
            <th className="view-left">Prompt</th>
            <th>AI Credits</th>
            <th>Input tok.</th>
          </tr>
        </thead>
        <tbody>
          {turns.map((turn) => (
            <TurnRow key={turn.turnIndex} port={port} sessionId={sessionId} provider={provider} turn={turn} open={openTurns.has(turn.turnIndex)} onToggle={() => toggle(turn.turnIndex)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
