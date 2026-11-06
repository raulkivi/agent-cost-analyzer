import type {
  InsightSessionRow,
  InsightToolCallRow,
  InsightTurnRow,
  Session,
  TokenCount,
  ToolCallRecord,
  Turn,
  TurnCostFigures,
} from "@agent-cost-analyzer/domain";
import { costBasisTotals, MAX_EVIDENCE_EXCERPT_LENGTH } from "@agent-cost-analyzer/domain";
import { TurnCostFigureBuilder, type TurnPricer } from "../pricing/turn-cost-figures.js";
import type { Attribution, AttributionSnapshot } from "../cost-attribution/session-attributor.js";
import { excerptOf } from "../tool-audit/output-redactor.js";
import { toolCallsUnavailableReason, turnToolCallsUnavailableReason } from "../tool-audit/tool-calls-availability.js";
import { statusOf } from "../tool-audit/outcome-tally.js";
import { resolveToolKind } from "../tool-audit/tool-kind-resolver.js";

// Phase 9.11 (docs/plans/insights-dashboard.md §3/§4): pure flattening of
// normalized Sessions from every provider into the dashboard's star schema.

export interface ProviderSessions {
  providerId: string;
  providerLabel: string;
  sessions: Session[];
}

export interface InsightRows {
  sessions: InsightSessionRow[];
  turns: InsightTurnRow[];
  toolCalls: InsightToolCallRow[];
}

// Phase 15 step 15.4: who each row's cost belongs to (SessionAttributor,
// DIP: any implementation of this port). A turn is attributed by its own
// folder and model, so a session that moved between repositories splits.
export type RowAttributor = Pick<AttributionSnapshot, "session" | "turn">;

const NOT_CONFIGURED_REASON = "Attribution is not configured for this dataset.";

// The attributor for callers that only need the figures (session cost) or
// predate attribution: every value is unknown, with the reason.
export const NOT_ATTRIBUTED: Attribution = {
  repository: { attributed: false, reason: NOT_CONFIGURED_REASON },
  projectId: null,
  vendor: { known: false, reason: NOT_CONFIGURED_REASON },
  channel: { known: false, reason: NOT_CONFIGURED_REASON },
};

const UNCONFIGURED: RowAttributor = { session: () => NOT_ATTRIBUTED, turn: () => NOT_ATTRIBUTED };

// Step 15.6: without a price book, billed and reported still come from the
// log and priced is unknown with the reason.
const UNPRICED: TurnPricer = new TurnCostFigureBuilder();

type AttributionRowFields = Pick<
  InsightTurnRow,
  "repositoryKey" | "unattributedReason" | "projectId" | "vendorId" | "vendorUnknownReason" | "channel" | "channelUnknownReason"
>;

export function attributionRowFields(attribution: Attribution): AttributionRowFields {
  const { repository, vendor, channel } = attribution;
  return {
    repositoryKey: repository.attributed ? repository.repository.key : null,
    ...(repository.attributed ? {} : { unattributedReason: repository.reason }),
    projectId: repository.attributed ? attribution.projectId : null,
    vendorId: vendor.known ? vendor.vendorId : null,
    ...(vendor.known ? {} : { vendorUnknownReason: vendor.reason }),
    channel: channel.known ? channel.channel : null,
    ...(channel.known ? {} : { channelUnknownReason: channel.reason }),
  };
}

export function sessionKeyOf(providerId: string, sessionId: string): string {
  return `${providerId}:${sessionId}`;
}

export function turnKeyOf(sessionKey: string, turnIndex: number): string {
  return `${sessionKey}:${turnIndex}`;
}

export function toolCallKeyOf(turnKey: string, callIndex: number): string {
  return `${turnKey}:${callIndex}`;
}

// Unknown stays null (constraint 6) so the UI can report coverage.
function figure(count: TokenCount): number | null {
  return count.known ? count.value : null;
}

function isEstimated(count: TokenCount): boolean {
  return count.known && count.estimated === true;
}

function validTime(value: string | undefined): Date | undefined {
  const time = value ? new Date(value) : undefined;
  return time && !Number.isNaN(time.getTime()) ? time : undefined;
}

function sessionRow(source: ProviderSessions, session: Session, attribution: Attribution): InsightSessionRow {
  const validStart = validTime(session.startedAt);
  return {
    key: sessionKeyOf(source.providerId, session.id),
    providerId: source.providerId,
    providerLabel: source.providerLabel,
    sessionId: session.id,
    title: session.title,
    model: session.model,
    ...(session.startedAt ? { startedAt: session.startedAt } : {}),
    ...(toolCallsUnavailableReason(session) ? { toolCallsUnavailable: true } : {}),
    ...(validStart ? { date: validStart.toISOString().slice(0, 10), hour: validStart.getUTCHours() } : {}),
    ...attributionRowFields(attribution),
  };
}

function turnRow(
  sessionKey: string,
  session: Session,
  turn: Turn,
  toolCallsUnknown: boolean,
  attribution: Attribution,
  cost: TurnCostFigures,
): InsightTurnRow {
  const { usage } = turn;
  const time = validTime(turn.startedAt) ?? validTime(session.startedAt);
  const counts = [usage.uncachedInput, usage.cacheWrite, usage.cacheRead, usage.reasoning, usage.output, usage.costAiCredits];
  return {
    key: turnKeyOf(sessionKey, turn.index),
    sessionKey,
    turnIndex: turn.index,
    model: usage.model,
    ...(turn.triggeredEvent ? { triggeredEvent: turn.triggeredEvent } : {}),
    uncachedInput: figure(usage.uncachedInput),
    cacheWrite: figure(usage.cacheWrite),
    cacheRead: figure(usage.cacheRead),
    reasoning: figure(usage.reasoning),
    output: figure(usage.output),
    aiCredits: figure(usage.costAiCredits),
    estimated: counts.some(isEstimated),
    toolCallCount: toolCallsUnknown ? null : turn.toolCalls.length,
    ...attributionRowFields(attribution),
    ...(time ? { date: time.toISOString().slice(0, 10) } : {}),
    cost,
  };
}

function toolCallRow(turnKey: string, call: ToolCallRecord, callIndex: number): InsightToolCallRow {
  const commandText = call.shell?.command ?? call.argsSummary;
  const command = commandText ? excerptOf(commandText, MAX_EVIDENCE_EXCERPT_LENGTH) : "";
  const program = call.shell?.program;
  const failureCategory = call.outcome?.failureCategory;
  return {
    key: toolCallKeyOf(turnKey, callIndex),
    turnKey,
    name: call.name,
    kind: call.kind ?? resolveToolKind(call.name),
    ...(program ? { program } : {}),
    status: statusOf(call),
    ...(failureCategory ? { failureCategory } : {}),
    ...(command ? { command } : {}),
    ...(call.startedAt ? { startedAt: call.startedAt } : {}),
    ...(call.durationMs !== undefined ? { durationMs: call.durationMs } : {}),
  };
}

// Step 15.6: each turn row carries its billed, reported and priced
// figures; each session row their per-basis totals with coverage.
export function buildInsightRows(
  sources: ProviderSessions[],
  attributor: RowAttributor = UNCONFIGURED,
  pricer: TurnPricer = UNPRICED,
): InsightRows {
  const rows: InsightRows = { sessions: [], turns: [], toolCalls: [] };
  for (const source of sources) {
    for (const session of source.sessions) {
      const sessionKey = sessionKeyOf(source.providerId, session.id);
      const turnCosts: TurnCostFigures[] = [];
      const row = sessionRow(source, session, attributor.session(source.providerId, session));
      rows.sessions.push(row);
      for (const turn of session.turns) {
        const turnKey = turnKeyOf(sessionKey, turn.index);
        const unknownCalls = turnToolCallsUnavailableReason(session, turn) !== undefined;
        const attribution = attributor.turn(source.providerId, session, turn);
        const cost = pricer.figuresFor(source.providerId, session, turn, attribution);
        turnCosts.push(cost);
        rows.turns.push(turnRow(sessionKey, session, turn, unknownCalls, attribution, cost));
        turn.toolCalls.forEach((call, callIndex) => rows.toolCalls.push(toolCallRow(turnKey, call, callIndex)));
      }
      row.cost = costBasisTotals(turnCosts);
    }
  }
  return rows;
}
