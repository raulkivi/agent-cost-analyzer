// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { TokenCount, TurnView } from "@agent-cost-analyzer/domain";
import { formatAiCreditsValue } from "@agent-cost-analyzer/web/lib/format-ai-credits";
import { eventLabel } from "./session-cost.js";
import { UNKNOWN_TEXT, formatCount, pluralize } from "./format.js";
import type { MeasureView } from "./format.js";

// The expanded turn under a top-turn row (docs/plans/mcp-apps.md §4.3):
// formats a get_turn result for display. Pure. The prompt excerpt is logged
// text: it is shown in the card and never forwarded to the model (§6).

export interface TurnDetailViewModel {
  heading: string;
  eventText?: string;
  prompt: { text: string; truncated: boolean } | { unavailable: string };
  tokens: { label: string; value: MeasureView }[];
  aiCredits: MeasureView;
  toolCalls: { count: string; summary: string; failed: number };
  subagents?: SubagentSectionViewModel;
}

// Step 10.19 (board U1TurnDetail): the runs a classic Copilot Chat turn folded in.
export interface SubagentRunRow {
  id: string;
  name: string; // the agent name; the label only when the log names no agent
  model: string;
  requests: string;
  aiCredits: MeasureView;
  reason?: string; // why the figure is unknown
  matchedByTime: boolean;
}

export interface SubagentSectionViewModel {
  heading: string;
  note: { text: string; known: boolean }; // the sub-line under the turn's AI Credits
  mainAgent: MeasureView;
  subagents: MeasureView;
  runs: SubagentRunRow[];
}

function figure(count: TokenCount, format: (value: number) => string): MeasureView {
  if (!count.known) return { text: UNKNOWN_TEXT, known: false, estimate: false };
  return { text: format(count.value), known: true, estimate: count.estimated === true };
}

function summariseToolCalls(view: TurnView): TurnDetailViewModel["toolCalls"] {
  if (view.toolCallsUnavailableReason !== undefined) return { count: UNKNOWN_TEXT, summary: view.toolCallsUnavailableReason, failed: 0 };
  const byName = new Map<string, number>();
  for (const call of view.toolCalls) byName.set(call.name, (byName.get(call.name) ?? 0) + 1);
  const summary = [...byName].map(([name, n]) => `${name} ×${n}`).join(" · ");
  return { count: formatCount(view.toolCalls.length), summary, failed: view.toolCalls.filter((call) => call.status === "error").length };
}

type Runs = NonNullable<TurnView["usage"]["subagents"]>;

function summariseSubagents(runs: Runs, ownUsage: NonNullable<TurnView["usage"]["ownUsage"]>): SubagentSectionViewModel {
  const rows: SubagentRunRow[] = runs.map((run) => {
    const credits = figure(run.costAiCredits, formatAiCreditsValue);
    const row: SubagentRunRow = {
      id: run.id,
      name: run.agentName ?? run.label,
      model: run.model === "" ? "model unknown" : run.model,
      requests: run.costAiCredits.known ? pluralize(run.roundsCount, "request") : "—",
      aiCredits: credits,
      matchedByTime: run.attribution === "timestamp",
    };
    if (!run.costAiCredits.known) row.reason = run.costAiCredits.reason;
    return row;
  });
  const unknown = runs.find((run) => !run.costAiCredits.known);
  const known = runs.reduce((sum, run) => sum + (run.costAiCredits.known ? run.costAiCredits.value : 0), 0);
  const byTime = runs.some((run) => run.attribution === "timestamp") ? ", matched by time" : "";
  const noun = pluralize(runs.length, "subagent run");
  const note =
    unknown !== undefined && !unknown.costAiCredits.known
      ? { text: `unknown: ${unknown.costAiCredits.reason}`, known: false }
      : { text: `incl. ${formatAiCreditsValue(known)} from ${noun}${byTime}`, known: true };
  return {
    heading: `Subagent runs (${formatCount(runs.length)})`,
    note,
    mainAgent: figure(ownUsage.costAiCredits, formatAiCreditsValue),
    subagents: unknown === undefined ? { text: formatAiCreditsValue(known), known: true, estimate: false } : { text: UNKNOWN_TEXT, known: false, estimate: false },
    runs: rows,
  };
}

export function toTurnDetailViewModel(view: TurnView): TurnDetailViewModel {
  const { usage } = view;
  const vm: TurnDetailViewModel = {
    heading: `Turn ${view.turnIndex} · ${view.model}`,
    prompt:
      view.textUnavailableReason !== undefined
        ? { unavailable: view.textUnavailableReason }
        : { text: view.userMessage, truncated: view.userMessageTruncated },
    tokens: [
      { label: "Uncached input", value: figure(usage.uncachedInput, formatCount) },
      { label: "Cache read", value: figure(usage.cacheRead, formatCount) },
      { label: "Cache write", value: figure(usage.cacheWrite, formatCount) },
      { label: "Output", value: figure(usage.output, formatCount) },
    ],
    aiCredits: figure(usage.costAiCredits, formatAiCreditsValue),
    toolCalls: summariseToolCalls(view),
  };
  const eventText = view.explanation || (view.triggeredEvent === undefined ? "" : eventLabel(view.triggeredEvent));
  if (eventText) vm.eventText = eventText;
  if (usage.subagents !== undefined && usage.ownUsage !== undefined) vm.subagents = summariseSubagents(usage.subagents, usage.ownUsage);
  return vm;
}
