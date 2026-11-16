// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type {
  Session,
  SubagentRunGap,
  SubagentRunUsage,
  SubagentSpend,
  TokenCount,
  ToolCallRecord,
  Turn,
  TurnUsage,
} from "@agent-cost-analyzer/domain";
import { knownWorkspace, sumTokenCounts, unavailableTokenCount, unknownWorkspace } from "@agent-cost-analyzer/domain";
import type {
  SessionFileRow,
  SessionRow,
  TurnRow,
} from "../../data-sources/sqlite/session-store.js";
import type { MainJsonlAvailability } from "../../data-sources/jsonl/main-jsonl-reader.js";
import type { AnalyzeModeExtras } from "./analyze-mode-extras.js";
import { describeTurnUsage } from "../turn-usage-sentence.js";

// Two reasons, per architecture.md §6.2: one is actionable (constraint 8),
// the other isn't. Extraction of real numbers from "events-present" logs is
// still Phase 4 work in progress — no extractor registry exists yet, so
// that case degrades to the same generic reason as "missing"/older-shape.
export const LOGGING_NEVER_ENABLED_REASON =
  "GitHub Copilot Chat debug logging (github.copilot.chat.agentDebugLog.fileLogging.enabled) " +
  "was off while this session ran, so no usage data was recorded. Enable it in VS Code " +
  "settings and reload the window to capture usage data for future sessions.";
export const USAGE_UNAVAILABLE_REASON =
  "Usage data is unavailable for this session or turn (main.jsonl is missing, uses an " +
  "older/unsupported log format, its usage data could not be extracted, debug logging " +
  "was switched on after the turn ran, or the turn could not be matched to the log with certainty).";
export const PARSE_FAILURES_REASON =
  "main.jsonl for this session has content, but none of its lines could be " +
  "parsed into a usable event — this looks like a parser regression or a " +
  "corrupted log file, not a settings problem.";
// The model name shown when no source names one.
export const UNKNOWN_MODEL = "unknown";
const STUB_EXPLANATION =
  "Token and AI Credits usage data is not available for this turn (main.jsonl parsing is not implemented yet).";
export const TOOL_CALL_TOKEN_COUNT_UNAVAILABLE_REASON =
  "GitHub Copilot Chat's local debug log does not record a token count for individual tool calls.";

function reasonForAvailability(availability: MainJsonlAvailability): string {
  if (availability === "logging-never-enabled") {
    return LOGGING_NEVER_ENABLED_REASON;
  }
  if (availability === "parse-failures") {
    return PARSE_FAILURES_REASON;
  }
  return USAGE_UNAVAILABLE_REASON;
}

// Phase 15 step 15.1: the store's sessions row has no cwd for this session.
export const STORE_NO_FOLDER_REASON =
  "The VS Code session store records no working folder for this session.";

export const STORE_TURN_MISSING_REASON =
  "GitHub Copilot Chat's session store has no record of this turn (it was likely interrupted, or was still " +
  "running when the store was read), so its text is unknown. Its tokens and AI Credits come from the debug log (main.jsonl).";

// Debug-log turns (one per user_message, placed on a store turn index by
// log-turn-alignment.ts, architecture.md §6.2.2) that the session store has no `turns` row for: an
// interrupted or still-running turn whose requests were billed all the same.
function logOnlyTurnIndices(
  storeTurnIndices: readonly number[],
  turnUsages: readonly (TurnUsage | null)[],
): number[] {
  const inStore = new Set(storeTurnIndices);
  return turnUsages.flatMap((_, index) => (inStore.has(index) ? [] : [index]));
}

// The session-level figures, shared by the list summary and the full
// session so the Sessions view, the turns table and the MCP tools agree.
export interface SessionUsageFigures {
  turnCount: number;
  costAiCredits: TokenCount;
  model: string;
  usageDataAvailable: boolean;
  subagentSpend?: SubagentSpend;
}

// A classic session's subagent runs, as subagent-attribution.ts's
// attributeSubagentRuns returns them (step 10.19).
export interface SessionSubagentRuns {
  byLogTurn: ReadonlyMap<number, readonly SubagentRunUsage[]>;
  // Empty exactly when every subagent log was read, placed and has known AI
  // Credits.
  sessionUnknownReasons: readonly string[];
}

// D12: the runs read and the AI Credits they added; unknown, never 0, when
// any subagent log left a reason. Absent when there is nothing to report.
function subagentSpendOf({ byLogTurn, sessionUnknownReasons }: SessionSubagentRuns): SubagentSpend | undefined {
  const runs = [...byLogTurn.entries()].sort(([a], [b]) => a - b).flatMap(([, turnRuns]) => turnRuns);
  const [reason] = sessionUnknownReasons;
  if (runs.length === 0 && reason === undefined) {
    return undefined;
  }
  return {
    runs: runs.length,
    costAiCredits:
      reason === undefined
        ? sumTokenCounts(runs.map((run) => run.costAiCredits), USAGE_UNAVAILABLE_REASON)
        : unavailableTokenCount(reason),
  };
}

// Every turn counts: each session-store turn and each debug-log turn the
// store lacks. AI Credits are all-or-nothing across them (constraint 6: no
// silently-partial total), and unknown rather than 0 with nothing to sum.
// With subagent runs, the turns already hold them (mergeSubagentUsage); a
// subagent reason (a run unread, unplaced or unknown) makes the session
// unknown even where every turn is known, and names why ahead of the
// turn-sum fallback.
export function summarizeSessionUsage(
  mainJsonlAvailability: MainJsonlAvailability,
  storeTurnIndices: readonly number[],
  turnUsages: readonly (TurnUsage | null)[],
  subagentRuns?: SessionSubagentRuns,
): SessionUsageFigures {
  const fallback = unavailableTokenCount(reasonForAvailability(mainJsonlAvailability));
  const turnIndices = [...storeTurnIndices, ...logOnlyTurnIndices(storeTurnIndices, turnUsages)];
  const knownUsages = turnUsages.filter((usage): usage is TurnUsage => usage !== null);
  const subagentReason = subagentRuns?.sessionUnknownReasons[0];
  const subagentSpend = subagentRuns === undefined ? undefined : subagentSpendOf(subagentRuns);
  return {
    turnCount: turnIndices.length,
    costAiCredits:
      mainJsonlAvailability !== "events-present" || turnIndices.length === 0
        ? fallback
        : subagentReason !== undefined
          ? unavailableTokenCount(subagentReason)
          : sumTokenCounts(
              turnIndices.map((index) => turnUsages[index]?.costAiCredits ?? fallback),
              USAGE_UNAVAILABLE_REASON,
            ),
    model: knownUsages.at(-1)?.model ?? UNKNOWN_MODEL,
    usageDataAvailable: knownUsages.length > 0,
    ...(subagentSpend === undefined ? {} : { subagentSpend }),
  };
}

// The title of a session whose source names none.
export function fallbackSessionTitle(sessionId: string): string {
  return `Session ${sessionId}`;
}

function deriveTitle(row: SessionRow): string {
  return row.summary || row.repository || row.cwd || fallbackSessionTitle(row.id);
}

function unavailableToolCallTokenCount(): TokenCount {
  return unavailableTokenCount(TOOL_CALL_TOKEN_COUNT_UNAVAILABLE_REASON);
}

// SQLite's session_files rows only cover tools that touched a file — tools
// like manage_todo_list/run_in_terminal never appear there. invokedToolNames
// (from main.jsonl's tool_call events, jsonl/tool-inventory.ts) fills that
// gap, one record per invocation (see buildToolCalls). Every
// entry's tokenCount is explicit-unavailable (constraint 6): neither source
// records a per-tool-call token figure.
// fileRows is pre-grouped by turn_index once per buildSession call (rather
// than re-filtered per turn here) so this is O(turns + fileRows), not
// O(turns × fileRows).
function groupFileRowsByTurn(
  fileRows: SessionFileRow[],
): Map<number, SessionFileRow[]> {
  const byTurn = new Map<number, SessionFileRow[]>();
  for (const row of fileRows) {
    if (row.turn_index === null) {
      continue;
    }
    const rows = byTurn.get(row.turn_index) ?? [];
    rows.push(row);
    byTurn.set(row.turn_index, rows);
  }
  return byTurn;
}

// `invoked` is the turn's tool_call invocations in log order: span records
// (step 10.20, D3: outcome, duration and bounded arguments) or name-only
// records where no span read was made.
function buildToolCalls(
  filesForTurn: SessionFileRow[],
  invoked: ToolCallRecord[],
): ToolCallRecord[] {
  const filesByToolName = new Map<string, string[]>();
  for (const row of filesForTurn) {
    const name = row.tool_name ?? "unknown tool";
    const files = filesByToolName.get(name) ?? [];
    files.push(row.file_path);
    filesByToolName.set(name, files);
  }

  // One record per jsonl tool_call invocation (Phase 9.10 audit: counts must
  // not be deduped by name). The first invocation of a tool that touched
  // files carries those paths; a name with files but no invocation stays one
  // file-only record, since SQLite alone can't say how many calls touched
  // those files.
  const firstByName = new Map<string, ToolCallRecord>();
  for (const call of invoked) {
    if (filesByToolName.has(call.name) && !firstByName.has(call.name)) {
      firstByName.set(call.name, call);
    }
  }
  const fileBasedCalls: ToolCallRecord[] = Array.from(filesByToolName.entries()).map(([name, filesTouched]) => {
    const first = firstByName.get(name);
    return {
      ...first,
      name,
      argsSummary: first?.argsSummary ? first.argsSummary : filesTouched.join(", "),
      filesTouched,
      tokenCount: unavailableToolCallTokenCount(),
    };
  });
  const consumed = new Set<ToolCallRecord>(firstByName.values());
  const invokedOnlyCalls: ToolCallRecord[] = invoked
    .filter((call) => !consumed.has(call))
    .map((call) => ({ ...call, tokenCount: unavailableToolCallTokenCount() }));

  // Keep each file-based record next to that tool's extra invocations.
  const ordered: ToolCallRecord[] = [];
  for (const fileCall of fileBasedCalls) {
    ordered.push(fileCall, ...invokedOnlyCalls.filter((call) => call.name === fileCall.name));
  }
  const fileNames = new Set(filesByToolName.keys());
  return [...ordered, ...invokedOnlyCalls.filter((call) => !fileNames.has(call.name))];
}

function nameOnlyCalls(names: string[]): ToolCallRecord[] {
  return names.map((name) => ({ name, argsSummary: "" }));
}

// Total fallback for a turn with zero extracted llm_request spans — with no
// requests there's nothing to join against agent-traces.db either, so every
// field (including cacheWrite/reasoning, Phase 8.5) staying unavailable here
// is still correct; this is "no usage data of any kind for this turn," not
// specifically "cache-write/reasoning unavailable" (see session-usage-spans.ts
// for that more specific case).
function buildUnavailableUsage(fallbackTokenCount: TokenCount): TurnUsage {
  return {
    uncachedInput: fallbackTokenCount,
    cacheWrite: fallbackTokenCount,
    cacheRead: fallbackTokenCount,
    tool: fallbackTokenCount,
    vision: fallbackTokenCount,
    reasoning: fallbackTokenCount,
    output: fallbackTokenCount,
    costAiCredits: fallbackTokenCount,
    model: UNKNOWN_MODEL,
  };
}

export function buildAnalyzeExplanation(usage: TurnUsage): string {
  return describeTurnUsage(usage);
}

// row is undefined for a debug-log turn the session store has no row for.
function buildTurn(
  index: number,
  row: TurnRow | undefined,
  fileRowsByTurn: Map<number, SessionFileRow[]>,
  usage: TurnUsage | null | undefined,
  fallbackTokenCount: TokenCount,
  invokedCalls: ToolCallRecord[],
  subagentCalls: readonly ToolCallRecord[] = [],
  subagentRunGaps: readonly SubagentRunGap[] = [],
  subagentRunsRead: readonly string[] = [],
  subagentRunsByTime: readonly string[] = [],
): Turn {
  const explanation = usage ? buildAnalyzeExplanation(usage) : STUB_EXPLANATION;
  return {
    index,
    userMessage: row?.user_message ?? "",
    assistantResponse: row?.assistant_response ?? "",
    // D2: the main agent's calls first; the runs' calls after, so a run's
    // read_file never takes the main agent's session_files paths.
    toolCalls: [
      ...buildToolCalls(fileRowsByTurn.get(index) ?? [], invokedCalls),
      ...subagentCalls.map((call) => ({ ...call, tokenCount: unavailableToolCallTokenCount() })),
    ],
    ...(subagentRunGaps.length > 0 ? { subagentRunGaps: [...subagentRunGaps] } : {}),
    ...(subagentRunsRead.length > 0 ? { subagentRunsRead: [...subagentRunsRead] } : {}),
    ...(subagentRunsByTime.length > 0 ? { subagentRunsByTime: [...subagentRunsByTime] } : {}),
    usage: usage ?? buildUnavailableUsage(fallbackTokenCount),
    ...(row?.timestamp ? { startedAt: row.timestamp } : {}),
    ...(row
      ? { explanation }
      : { explanation: `${explanation} ${STORE_TURN_MISSING_REASON}`, textUnavailableReason: STORE_TURN_MISSING_REASON }),
  };
}

// Before any usage is read, the store's own turn count and nothing known.
function storeOnlyUsageFigures(row: SessionRow): SessionUsageFigures {
  return {
    turnCount: row.turn_count,
    costAiCredits: unavailableTokenCount(USAGE_UNAVAILABLE_REASON),
    model: UNKNOWN_MODEL,
    usageDataAvailable: false,
  };
}

export function buildSessionSummary(
  row: SessionRow,
  usage: SessionUsageFigures = storeOnlyUsageFigures(row),
): Session {
  return {
    id: row.id,
    mode: "analyze",
    title: deriveTitle(row),
    model: usage.model,
    turns: [],
    turnCount: usage.turnCount,
    costAiCredits: usage.costAiCredits,
    ...(usage.subagentSpend === undefined ? {} : { subagentSpend: usage.subagentSpend }),
    usageDataAvailable: usage.usageDataAvailable,
    copilotHarness: "local",
    ...(row.created_at ? { startedAt: row.created_at } : {}),
    workspace:
      knownWorkspace(row.cwd, { repositoryHint: row.repository, branch: row.branch }) ??
      unknownWorkspace(STORE_NO_FOLDER_REASON),
  };
}

export interface AnalyzeEnrichment extends Partial<AnalyzeModeExtras> {
  sessionRow: SessionRow;
  turnRows: TurnRow[];
  fileRows: SessionFileRow[];
  mainJsonlAvailability: MainJsonlAvailability;
  // Placed per store turn index, with any subagent runs already merged in.
  turnUsages?: (TurnUsage | null)[];
  // Step 10.20 (D3): the debug log's tool_call spans as records, per store
  // turn index. Where a turn has none, invokedToolNamesByTurn's names stand.
  toolCallsByTurn?: ToolCallRecord[][];
  // Step 10.20 (§5.2): the calls of the subagent runs a turn started, each with
  // its origin, and the runs whose calls are unknown, per store turn index.
  subagentToolCallsByTurn?: ToolCallRecord[][];
  subagentRunGapsByTurn?: SubagentRunGap[][];
  subagentRunsReadByTurn?: string[][];
  subagentRunsByTimeByTurn?: string[][];
  subagentRuns?: SessionSubagentRuns;
}

export function buildSession(enrichment: AnalyzeEnrichment): Session {
  const {
    sessionRow,
    turnRows,
    fileRows,
    mainJsonlAvailability,
    turnUsages = [],
    invokedToolNamesByTurn = [],
    toolCallsByTurn = [],
    subagentToolCallsByTurn = [],
    subagentRunGapsByTurn = [],
    subagentRunsReadByTurn = [],
    subagentRunsByTimeByTurn = [],
    systemPrompt = [],
    toolInventory = [],
    subagentRuns,
  } = enrichment;

  const fallbackTokenCount = unavailableTokenCount(
    reasonForAvailability(mainJsonlAvailability),
  );
  const fileRowsByTurn = groupFileRowsByTurn(fileRows);
  // A turn whose log names calls never shows fewer than the name list: an
  // empty span read does not hide them.
  const invokedCallsAt = (index: number): ToolCallRecord[] => {
    const spans = toolCallsByTurn[index];
    return spans !== undefined && spans.length > 0 ? spans : nameOnlyCalls(invokedToolNamesByTurn[index] ?? []);
  };
  const buildAt = (index: number, row: TurnRow | undefined) =>
    buildTurn(
      index,
      row,
      fileRowsByTurn,
      turnUsages[index],
      fallbackTokenCount,
      invokedCallsAt(index),
      subagentToolCallsByTurn[index],
      subagentRunGapsByTurn[index],
      subagentRunsReadByTurn[index],
      subagentRunsByTimeByTurn[index],
    );

  const storeTurnIndices = turnRows.map((row) => row.turn_index);
  // Stable sort: the store's own rows keep their order.
  const turns = [
    ...turnRows.map((row) => buildAt(row.turn_index, row)),
    ...logOnlyTurnIndices(storeTurnIndices, turnUsages).map((index) => buildAt(index, undefined)),
  ].sort((a, b) => a.index - b.index);

  return {
    ...buildSessionSummary(
      sessionRow,
      summarizeSessionUsage(mainJsonlAvailability, storeTurnIndices, turnUsages, subagentRuns),
    ),
    systemPrompt,
    toolInventory,
    turns,
  };
}
