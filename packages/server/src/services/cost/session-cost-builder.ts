import type { Session, SessionCost, TokenCount } from "@copilot-cost-analyzer/domain";
import { buildInsightRows } from "../insights/insights-dataset-builder.js";
import { excerptOf } from "../tool-audit/output-redactor.js";
import {
  byCostDescending,
  cacheHitRatio,
  costFigures,
  costMeasures,
  groupBy,
  inputTokensOf,
  rankingFor,
} from "./cost-aggregation.js";

// Phase 9.12 (docs/plans/mcp-tools-v2.md §4): Session → SessionCost. Pure.

export const DEFAULT_TOP_TURNS = 5;
const USER_MESSAGE_EXCERPT_LENGTH = 160;
const MAX_NEVER_INVOKED_LISTED = 50;
const NO_CONTEXT_OVERHEAD_REASON =
  "This session's log provider records neither a system prompt breakdown nor a tool inventory.";

export interface SessionCostOptions {
  topTurns?: number;
}

function figure(count: TokenCount): number | null {
  return count.known ? count.value : null;
}

function unavailableReasons(session: Session): string[] {
  const reasons = new Set<string>();
  for (const turn of session.turns) {
    const { uncachedInput, cacheWrite, cacheRead, reasoning, output, costAiCredits } = turn.usage;
    for (const count of [uncachedInput, cacheWrite, cacheRead, reasoning, output, costAiCredits]) {
      if (!count.known) {
        reasons.add(count.reason);
      }
    }
  }
  return [...reasons];
}

function contextOverhead(session: Session): SessionCost["contextOverhead"] {
  const { systemPrompt, toolInventory } = session;
  if (!systemPrompt?.length && !toolInventory?.length) {
    return { unavailableReason: NO_CONTEXT_OVERHEAD_REASON };
  }
  const overhead: SessionCost["contextOverhead"] = {};
  if (systemPrompt?.length) {
    const components = systemPrompt.map(({ kind, label, tokenCount }) => ({ kind, label, tokens: figure(tokenCount) }));
    const known = components.flatMap((c) => (c.tokens === null ? [] : [c.tokens]));
    overhead.systemPrompt = { tokens: known.length ? known.reduce((a, b) => a + b, 0) : null, components };
  }
  if (toolInventory?.length) {
    const neverInvoked = toolInventory.filter((tool) => tool.invokedInTurns.length === 0).map((tool) => tool.name);
    overhead.toolInventory = {
      defined: toolInventory.length,
      loaded: toolInventory.filter((tool) => tool.loaded).length,
      invoked: toolInventory.length - neverInvoked.length,
      neverInvokedCount: neverInvoked.length,
      neverInvoked: neverInvoked.slice(0, MAX_NEVER_INVOKED_LISTED),
    };
  }
  return overhead;
}

export function buildSessionCost(session: Session, options: SessionCostOptions = {}): SessionCost {
  const { turns: rows } = buildInsightRows([{ providerId: session.providerId ?? "", providerLabel: "", sessions: [session] }]);
  const turnsByIndex = new Map(session.turns.map((turn) => [turn.index, turn]));
  const rankedBy = rankingFor(rows);

  const topTurns = rows
    .map((row) => ({
      turnIndex: row.turnIndex,
      model: row.model,
      ...(row.triggeredEvent ? { triggeredEvent: row.triggeredEvent } : {}),
      inputTokens: inputTokensOf(row),
      output: row.output,
      aiCredits: row.aiCredits,
      toolCalls: row.toolCallCount,
      userMessage: excerptOf(turnsByIndex.get(row.turnIndex)?.userMessage ?? "", USER_MESSAGE_EXCERPT_LENGTH),
    }))
    .sort(byCostDescending(rankedBy))
    .slice(0, options.topTurns ?? DEFAULT_TOP_TURNS);

  const byModel = [...groupBy(rows, (row) => row.model)]
    .map(([model, modelRows]) => ({ model, ...costFigures(modelRows) }))
    .sort(byCostDescending(rankedBy));

  return {
    sessionId: session.id,
    ...(session.providerId ? { providerId: session.providerId } : {}),
    title: session.title,
    model: session.model,
    ...(session.startedAt ? { startedAt: session.startedAt } : {}),
    turnCount: session.turns.length,
    totals: costMeasures(rows),
    cacheHitRatio: cacheHitRatio(rows),
    byModel,
    rankedBy,
    topTurns,
    events: session.turns.flatMap((turn) => (turn.triggeredEvent ? [{ turnIndex: turn.index, event: turn.triggeredEvent }] : [])),
    contextOverhead: contextOverhead(session),
    unavailableReasons: unavailableReasons(session),
  };
}
