// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useId } from "react";
import type { Turn } from "@agent-cost-analyzer/domain";
import { pricedBreakdown } from "../lib/subagent-priced.js";
import type { PricedFigure, PricedRunRow } from "../lib/subagent-priced.js";
import { Tag } from "./ui/Tag.js";

// The Explanation panel's block for a turn without AI Credits (Claude Code,
// step CS13, CS2 board): a row per run with tokens and priced cost, then the
// main agent's, the runs' and the turn's figures. An unknown part reads as a
// dash with its reason; no total adds only what is known.
// Names and reasons are log text, rendered as React text only.

function Figure({ figure, unit }: { figure: PricedFigure; unit?: string }) {
  return figure.known ? (
    <span>
      {figure.text}
      {unit && <span className="text-muted"> {unit}</span>}
    </span>
  ) : (
    <span>
      <span aria-hidden="true">—</span>
      <span className="sr-only">unknown</span>
    </span>
  );
}

function RunRow({ run }: { run: PricedRunRow }) {
  return (
    <li className={run.unknown ? "subagent-run subagent-run--unknown" : "subagent-run"}>
      <span className="subagent-run-name">{run.name}</span>
      {run.matchedByTime && <Tag variant="outline">matched by time</Tag>}
      <span className="text-muted">{run.model}</span>
      <span className="text-muted">{run.requests}</span>
      <span className="subagent-run-credits">
        <Figure figure={run.tokens} unit="tokens" /> <strong>{run.cost.known ? run.cost.text : <Figure figure={run.cost} />}</strong>
      </span>
      {run.startedBy !== undefined && <span className="subagent-run-reason text-muted">Started by {run.startedBy}.</span>}
      {run.reason !== undefined && <span className="subagent-run-reason text-muted">{run.reason}</span>}
    </li>
  );
}

export function PricedSubagentRunsBlock({ turn }: { turn: Turn }) {
  const headingId = useId();
  const view = pricedBreakdown(turn.usage);
  if (!view) return null;
  return (
    <section aria-labelledby={headingId} className="subagent-block">
      <div className="subagent-block-title">
        <span id={headingId}>Subagent runs this turn</span> <Tag variant="outline">Priced</Tag>
      </div>
      <ul className="subagent-runs">
        {view.runs.map((run) => (
          <RunRow key={run.id} run={run} />
        ))}
      </ul>
      <div role="group" aria-label="Turn totals" className="subagent-totals">
        <span>
          Main agent <strong>{view.main.text}</strong>
        </span>{" "}
        <span>
          Subagent runs <strong>{view.subagents.text}</strong>
        </span>{" "}
        <span>
          Turn <strong>{view.turn.text}</strong>
        </span>
      </div>
      {view.share !== undefined && <p className="subagent-share text-muted">{view.share}</p>}
      {view.unknownNote !== undefined && <p className="subagent-share text-muted">{view.unknownNote}</p>}
      <p className="subagent-share text-muted">{view.priceNote}</p>
    </section>
  );
}
