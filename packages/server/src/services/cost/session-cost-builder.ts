// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { costBasisTotals, splitByModel, type Session, type SessionCost, type TokenCount } from "@agent-cost-analyzer/domain";
import { attributionRowFields, buildInsightRows, type RowAttributor } from "../insights/insights-dataset-builder.js";
import type { TurnPricer } from "../pricing/turn-cost-figures.js";
import { excerptOf } from "../tool-audit/output-redactor.js";
import {
  byCostDescending,
  cacheHitRatio,
  costFigures,
  costMeasures,
  costOf,
  groupBy,
  inputTokensOf,
  rankingFor,
} from "./cost-aggregation.js";
import { sessionActivity } from "./session-activity.js";

// Phase 9.12 (docs/plans/mcp-tools-v2.md §4): Session → SessionCost. Pure.

export const DEFAULT_TOP_TURNS = 5;
const USER_MESSAGE_EXCERPT_LENGTH = 160;
const MAX_NEVER_INVOKED_LISTED = 50;
const NO_CONTEXT_OVERHEAD_REASON =
  "This session's log provider records neither a system prompt breakdown nor a tool inventory.";

export interface SessionCostOptions {
  topTurns?: number;
}

// Step 15.6: who the session belongs to and how its turns are priced. Both
// optional, so a caller without attribution or a price book still gets
// billed and reported figures, and priced ones as unknown with the reason.
export interface SessionCostContext {
  providerId?: string;
  attributor?: RowAttributor;
  pricer?: TurnPricer;
  // The time activity is judged against; without it, no activity fields.
  now?: Date;
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

function subagentSummary(session: Session): Pick<SessionCost, "subagents"> {
  const spend = session.subagentSpend;
  if (!spend) return {};
  const { costAiCredits } = spend;
  return {
    subagents: costAiCredits.known
      ? { runs: spend.runs, aiCredits: costAiCredits.value }
      : { runs: spend.runs, aiCredits: null, unavailableReason: costAiCredits.reason },
  };
}

export function buildSessionCost(session: Session, options: SessionCostOptions = {}, context: SessionCostContext = {}): SessionCost {
  const providerId = context.providerId ?? session.providerId ?? "";
  const { turns: rows } = buildInsightRows([{ providerId, providerLabel: "", sessions: [session] }], context.attributor, context.pricer);
  const attribution = context.attributor ? attributionRowFields(context.attributor.session(providerId, session)) : undefined;
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
      cost: costOf(row),
    }))
    .sort(byCostDescending(rankedBy))
    .slice(0, options.topTurns ?? DEFAULT_TOP_TURNS);

  // Step 10.19: by each cost line's model, so a subagent run's model gets its share.
  const byModel = [...groupBy(rows.flatMap(splitByModel), (row) => row.model)]
    .map(([model, modelRows]) => ({ model, ...costFigures(modelRows) }))
    .sort(byCostDescending(rankedBy));

  return {
    sessionId: session.id,
    ...(session.providerId ? { providerId: session.providerId } : {}),
    title: session.title,
    model: session.model,
    ...(session.startedAt ? { startedAt: session.startedAt } : {}),
    ...(context.now ? sessionActivity(session.turns.map((turn) => turn.startedAt), context.now) : {}),
    turnCount: session.turns.length,
    ...(attribution
      ? {
          repositoryKey: attribution.repositoryKey,
          ...(attribution.unattributedReason ? { unattributedReason: attribution.unattributedReason } : {}),
          projectId: attribution.projectId,
        }
      : {}),
    totals: costMeasures(rows),
    cost: costBasisTotals(rows.map(costOf)),
    cacheHitRatio: cacheHitRatio(rows),
    byModel,
    rankedBy,
    topTurns,
    events: session.turns.flatMap((turn) => (turn.triggeredEvent ? [{ turnIndex: turn.index, event: turn.triggeredEvent }] : [])),
    contextOverhead: contextOverhead(session),
    ...subagentSummary(session),
    unavailableReasons: unavailableReasons(session),
  };
}
