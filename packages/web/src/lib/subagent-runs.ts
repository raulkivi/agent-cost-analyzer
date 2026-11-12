// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { sumTokenCounts } from "@agent-cost-analyzer/domain";
import type { SubagentRunUsage, SubagentSpend, TokenCount, Turn } from "@agent-cost-analyzer/domain";
import { formatAiCreditsValue } from "./format-ai-credits.js";

// Step 10.19 (SA13): the wording the web panel uses for a turn's classic
// Copilot subagent runs, so the marker, the drawer line, the Explanation
// block and the inspector note agree. Unknown is never a figure.

const runsNoun = (count: number) => `${count} ${count === 1 ? "subagent run" : "subagent runs"}`;

// The agent's name; the log's label only when the run has no agent name.
export function runDisplayName(run: Pick<SubagentRunUsage, "agentName" | "label">): string {
  return run.agentName ?? run.label;
}

export interface SubagentSummary {
  runs: readonly SubagentRunUsage[];
  // What the readable runs added; unknown when the turn's total is.
  total: TokenCount;
  unknown: boolean;
  // Runs the reader couldn't read stand only in the unknown total, so a
  // turn with an unknown total and no unknown listed part has one.
  unreadRun: boolean;
  unreadOnly: boolean;
  matchedByTime: boolean;
  // The marker's tooltip and accessible name.
  text: string;
}

export function subagentSummary(turn: Turn): SubagentSummary | undefined {
  const { subagents, ownUsage, costAiCredits } = turn.usage;
  if (subagents === undefined) return undefined;
  const runsTotal = sumTokenCounts(
    subagents.map((run) => run.costAiCredits),
    "",
  );
  const unknown = !costAiCredits.known || !runsTotal.known;
  const unreadRun = !costAiCredits.known && runsTotal.known && (ownUsage?.costAiCredits.known ?? true);
  const matchedByTime = subagents.some((run) => run.attribution === "timestamp");
  const reason = !costAiCredits.known ? costAiCredits.reason : !runsTotal.known ? runsTotal.reason : "";
  const text = unknown
    ? `AI Credits unknown: ${reason}`
    : `incl. ${formatAiCreditsValue((runsTotal as { value: number }).value)} AI Credits from ${runsNoun(subagents.length)}${matchedByTime ? ", matched by time" : ""}`;
  return {
    runs: subagents,
    total: unknown ? { known: false, reason } : runsTotal,
    unknown,
    unreadRun,
    unreadOnly: unreadRun && subagents.length === 0,
    matchedByTime,
    text,
  };
}

export interface SubagentNote {
  heading: string;
  body: string;
}

// D4: the Turn inspector keeps the main agent's rounds and says what it leaves out.
export function subagentInspectorNote(turn: Turn): SubagentNote | undefined {
  const summary = subagentSummary(turn);
  if (!summary) return undefined;
  const { runs } = summary;
  const left = "The rounds below are the main agent's.";
  if (summary.unknown) {
    const heading = runs.length === 0 ? "Subagent runs are not shown here." : `${runsNoun(runs.length)} ${runs.length === 1 ? "is" : "are"} not shown here.`;
    return { heading, body: `A run could not be read, so this turn's AI Credits are unknown. ${left}` };
  }
  const heading = `${runsNoun(runs.length)} ${runs.length === 1 ? "is" : "are"} not shown here.`;
  const credits = formatAiCreditsValue((summary.total as { value: number }).value);
  if (runs.every((run) => run.roundsCount === 0)) {
    return { heading, body: `${runs.length === 1 ? "It recorded" : "They recorded"} no model request (${credits} AI Credits). ${left}` };
  }
  return { heading, body: `${runs.length === 1 ? "Its" : "Their"} ${credits} AI Credits are in this turn's total. ${left}` };
}

// The KPI tile's sub-line (D12); "matched by time" stays out of it.
export function sessionSubagentLine(spend: SubagentSpend | undefined): string | undefined {
  if (!spend) return undefined;
  if (!spend.costAiCredits.known) return `unknown: ${spend.costAiCredits.reason}`;
  return `incl. ${formatAiCreditsValue(spend.costAiCredits.value)} from ${runsNoun(spend.runs)}`;
}

// The Sessions list's line, worded as the extension's tooltip line.
export function sessionListSubagentLine(spend: SubagentSpend): string {
  if (!spend.costAiCredits.known) return `AI Credits unknown: ${spend.costAiCredits.reason}`;
  return `incl. ${formatAiCreditsValue(spend.costAiCredits.value)} AI Credits from ${runsNoun(spend.runs)}`;
}
