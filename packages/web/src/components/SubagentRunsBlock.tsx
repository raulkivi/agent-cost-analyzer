// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useId } from "react";
import type { SubagentRunUsage, Turn } from "@agent-cost-analyzer/domain";
import { formatAiCredits } from "../lib/format-ai-credits.js";
import { runDisplayName, subagentSummary } from "../lib/subagent-runs.js";
import { Tag } from "./ui/Tag.js";

// "unknown" is how the cost lines name a run's model when it wasn't read; a
// model name never reads "unknown".
const UNREAD_MODEL = "unknown";

const requests = (count: number) => `${count} ${count === 1 ? "request" : "requests"}`;

function RunRow({ run }: { run: SubagentRunUsage }) {
  const unknown = !run.costAiCredits.known;
  return (
    <li className={unknown ? "subagent-run subagent-run--unknown" : "subagent-run"}>
      <span className="subagent-run-name">{runDisplayName(run)}</span>
      {run.attribution === "timestamp" && <Tag variant="outline">matched by time</Tag>}
      {run.model !== UNREAD_MODEL && <span className="text-muted">{run.model}</span>}
      <span className="text-muted">{requests(run.roundsCount)}</span>
      <span className="subagent-run-credits">
        {formatAiCredits(run.costAiCredits)} <span className="text-muted">AI Credits</span>
      </span>
      {run.costAiCredits.known ? null : <span className="subagent-run-reason text-muted">{run.costAiCredits.reason}</span>}
    </li>
  );
}

// A run the reader couldn't read has no row of its own in the turn's data; its
// reason is the turn's unknown total.
function UnreadRunRow({ reason }: { reason: string }) {
  return (
    <li className="subagent-run subagent-run--unknown">
      <span className="subagent-run-name">Subagent run not read</span>
      <span className="subagent-run-credits">— <span className="text-muted">AI Credits</span></span>
      <span className="subagent-run-reason text-muted">{reason}</span>
    </li>
  );
}

// The Explanation panel's "Subagent runs this turn" block (step 10.19, SA0b):
// a row per run, then the main agent's own figure (D10), the runs' and the
// turn's, so the split stays readable when a run is unknown.
export function SubagentRunsBlock({ turn }: { turn: Turn }) {
  const headingId = useId();
  const summary = subagentSummary(turn);
  if (!summary) return null;
  const own = turn.usage.ownUsage?.costAiCredits;
  const unknownText = "unknown";
  return (
    <section aria-labelledby={headingId} className="subagent-block">
      <div id={headingId} className="subagent-block-title">
        Subagent runs this turn
      </div>
      <ul className="subagent-runs">
        {summary.runs.map((run) => (
          <RunRow key={run.id} run={run} />
        ))}
        {summary.unreadRun && !summary.total.known && <UnreadRunRow reason={summary.total.reason} />}
      </ul>
      <div role="group" aria-label="Turn totals" className="subagent-totals">
        {own && (
          <span>
            Main agent <strong>{formatAiCredits(own)}</strong>
          </span>
        )}{" "}
        <span>
          Subagent runs <strong>{summary.total.known ? formatAiCredits(summary.total) : unknownText}</strong>
        </span>{" "}
        <span>
          Turn <strong>{turn.usage.costAiCredits.known ? formatAiCredits(turn.usage.costAiCredits) : unknownText}</strong>
        </span>
      </div>
    </section>
  );
}
