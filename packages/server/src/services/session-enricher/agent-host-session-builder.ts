import type { Session, TokenCount, Turn, TurnUsage } from "@agent-cost-analyzer/domain";
import { sumTokenCounts, unavailableTokenCount } from "@agent-cost-analyzer/domain";
import type { AgentHostSessionRow } from "../../data-sources/agent-host/agent-host-catalog.js";
import {
  nanoAiuToAiCredits,
  type AgentHostTurnRow,
  type AgentHostTurnUsage,
} from "../../data-sources/agent-host/agent-session-store.js";
import { buildAnalyzeExplanation, fallbackSessionTitle, UNKNOWN_MODEL } from "./session-enricher.js";

// Maps VS Code Agent Host sessions (vscode-extension.md step 10.13) to the
// domain shapes, the counterpart of session-enricher.ts for classic Copilot
// Chat sessions. Pure: the readers in data-sources/agent-host/ do the I/O.

export const AGENT_HOST_FIELD_NOT_RECORDED_REASON =
  "VS Code's Agent Host doesn't record this token count (only input, cached input and output tokens per turn).";
export const AGENT_HOST_TURN_TOKENS_UNAVAILABLE_REASON =
  "VS Code's Agent Host recorded no token totals for this turn.";
export const AGENT_HOST_TURN_COST_UNAVAILABLE_REASON =
  "VS Code's Agent Host recorded no AI Credits for this turn.";
export const AGENT_HOST_SESSION_COST_UNAVAILABLE_REASON =
  "VS Code's Agent Host recorded no AI Credits for at least one turn of this session, so its total is unknown.";
export const AGENT_HOST_NO_TURNS_REASON = "VS Code's Agent Host has recorded no turns for this session.";
export const AGENT_HOST_SESSION_DB_MISSING_REASON =
  "This session's Agent Host database (agentSessionData/<session>/session.db) is missing or unreadable, so its turns and usage are unknown.";
export const AGENT_HOST_TURN_TEXT_UNAVAILABLE_NOTE =
  "The prompt and response text of Agent Host sessions isn't read yet, so this turn shows only its tokens and AI Credits.";

// What one session.db holds, already read; null when the file is missing.
export interface AgentHostSessionStoreContents {
  turns: AgentHostTurnRow[];
  model: string | null;
  title: string | null;
}

export interface AgentHostSessionInput {
  catalogRow: AgentHostSessionRow;
  store: AgentHostSessionStoreContents | null;
}

function known(value: number): TokenCount {
  return { known: true, value };
}

export function buildAgentHostTurnUsage(usage: AgentHostTurnUsage | null): TurnUsage {
  const notRecorded = unavailableTokenCount(AGENT_HOST_FIELD_NOT_RECORDED_REASON);
  const noTokens = unavailableTokenCount(AGENT_HOST_TURN_TOKENS_UNAVAILABLE_REASON);
  const tokens = usage?.tokens ?? null;
  const nanoAiu = usage?.nanoAiu ?? null;
  return {
    // The Agent Host's input count includes the cache hits.
    uncachedInput: tokens ? known(Math.max(tokens.input - tokens.cached, 0)) : noTokens,
    cacheWrite: notRecorded,
    cacheRead: tokens ? known(tokens.cached) : noTokens,
    tool: notRecorded,
    vision: notRecorded,
    reasoning: notRecorded,
    output: tokens ? known(tokens.output) : noTokens,
    costAiCredits:
      nanoAiu === null ? unavailableTokenCount(AGENT_HOST_TURN_COST_UNAVAILABLE_REASON) : known(nanoAiuToAiCredits(nanoAiu)),
    model: usage?.model ?? UNKNOWN_MODEL,
  };
}

function buildExplanation(row: AgentHostTurnRow, usage: TurnUsage): string {
  const tokens = row.usage?.tokens ? buildAnalyzeExplanation(usage) : AGENT_HOST_TURN_TOKENS_UNAVAILABLE_REASON;
  return `${tokens} ${AGENT_HOST_TURN_TEXT_UNAVAILABLE_NOTE}`;
}

function buildTurn(row: AgentHostTurnRow, index: number): Turn {
  const usage = buildAgentHostTurnUsage(row.usage);
  return {
    index,
    userMessage: "",
    assistantResponse: "",
    toolCalls: [],
    usage,
    explanation: buildExplanation(row, usage),
  };
}

function hasUsageRecord(row: AgentHostTurnRow): boolean {
  return row.usage !== null && (row.usage.tokens !== null || row.usage.nanoAiu !== null);
}

function lastTurnModel(rows: AgentHostTurnRow[]): string | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const model = rows[i].usage?.model;
    if (model) {
      return model;
    }
  }
  return null;
}

// An invalid Date throws from toISOString, and a session without a start is
// still listable (startedAt is optional in the domain).
function isoStart(startedAtMs: number): string | undefined {
  return Number.isFinite(startedAtMs) ? new Date(startedAtMs).toISOString() : undefined;
}

// All-or-nothing like the classic path (constraint 6), and unknown rather
// than 0 when there's nothing to sum, as computeSessionCost does.
function sessionCost(store: AgentHostSessionStoreContents | null, turns: Turn[]): TokenCount {
  if (store === null) {
    return unavailableTokenCount(AGENT_HOST_SESSION_DB_MISSING_REASON);
  }
  if (turns.length === 0) {
    return unavailableTokenCount(AGENT_HOST_NO_TURNS_REASON);
  }
  return sumTokenCounts(
    turns.map((built) => built.usage.costAiCredits),
    AGENT_HOST_SESSION_COST_UNAVAILABLE_REASON,
  );
}

// No providerId: the provider that lists the session stamps its own.
export function buildAgentHostSession({ catalogRow, store }: AgentHostSessionInput): Session {
  const rows = store?.turns ?? [];
  const turns = rows.map(buildTurn);
  const startedAt = isoStart(catalogRow.startedAtMs);
  return {
    id: catalogRow.id,
    mode: "analyze",
    title: store?.title ?? catalogRow.title ?? fallbackSessionTitle(catalogRow.id),
    model: store?.model ?? lastTurnModel(rows) ?? UNKNOWN_MODEL,
    turns,
    turnCount: turns.length,
    costAiCredits: sessionCost(store, turns),
    usageDataAvailable: rows.some(hasUsageRecord),
    ...(startedAt ? { startedAt } : {}),
  };
}

// The list's summary (turns: [], the GET /api/sessions contract). The turns
// are read anyway for the session's AI Credits, so the rest is exact.
export function buildAgentHostSessionSummary(input: AgentHostSessionInput): Session {
  return { ...buildAgentHostSession(input), turns: [] };
}
