// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useId } from "react";
import { isFailedStatus } from "@agent-cost-analyzer/domain";
import type { SubagentRunUsage, Turn } from "@agent-cost-analyzer/domain";
import { formatAiCredits } from "../lib/format-ai-credits.js";
import { runDisplayName, subagentSummary } from "../lib/subagent-runs.js";
import { Tag } from "./ui/Tag.js";

// "unknown" is how the cost lines name a run's model when it wasn't read; a
// model name never reads "unknown".
const UNREAD_MODEL = "unknown";

const requests = (count: number) => `${count} ${count === 1 ? "request" : "requests"}`;

// What the turn's tool calls say about a run (step 10.20). A run with no call
// is known to have made none only when the reader read its log in full;
// otherwise its calls are unknown, never 0.
function callsText(turn: Turn, runId: string): string {
  const calls = turn.toolCalls.filter((call) => call.origin?.kind === "subagent" && call.origin.runId === runId);
  if (calls.length === 0) {
    return turn.subagentRunsRead?.includes(runId) ? "0 calls" : "calls unknown";
  }
  const failed = calls.filter((call) => call.outcome && isFailedStatus(call.outcome.status)).length;
  return `${calls.length} ${calls.length === 1 ? "call" : "calls"}, ${failed} failed`;
}

function RunRow({ run, calls }: { run: SubagentRunUsage; calls: string }) {
  const unknown = !run.costAiCredits.known;
  return (
    <li className={unknown ? "subagent-run subagent-run--unknown" : "subagent-run"}>
      <span className="subagent-run-name">{runDisplayName(run)}</span>
      {run.attribution === "timestamp" && <Tag variant="outline">matched by time</Tag>}
      {run.model !== UNREAD_MODEL && <span className="text-muted">{run.model}</span>}
      <span className="text-muted">{requests(run.roundsCount)}</span>
      <span className="text-muted">{calls}</span>
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
  const showsUnreadRow = summary.unreadRun && !summary.total.known;
  return (
    <section aria-labelledby={headingId} className="subagent-block">
      <div id={headingId} className="subagent-block-title">
        Subagent runs this turn
      </div>
      <ul className="subagent-runs">
        {summary.runs.map((run) => (
          <RunRow key={run.id} run={run} calls={callsText(turn, run.id)} />
        ))}
        {/* The unread row above already gives the turn's reason; a gap row adds the tool-call reason of a run the cost side read. */}
        {(showsUnreadRow ? [] : (turn.subagentRunGaps ?? [])).map((gap) => (
          <li key={gap.runId} className="subagent-run subagent-run--unknown">
            <span className="subagent-run-name">{gap.label}</span>
            <span className="subagent-run-reason text-muted">{gap.reason}</span>
          </li>
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
