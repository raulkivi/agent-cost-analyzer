// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// MS10 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/monthly-allowance-standalone.md §11, D11): an independent
// oracle for the monthly allowance's real-data check. It reads the raw logs and
// shares no code with the product: the session readers, the alignment of log
// turns to store turns, the allowance figures and the period are each written
// here or taken from the other script oracles, themselves independent of the
// product (allowance-oracle.test.mts follows every import):
//   - classic Copilot Chat: main.jsonl and the subagent runs' logs through the
//     step 10.19 SA18 scanner (subagent-spend-lib.mts);
//   - the log-to-store turn alignment and the Agent Host session.db reader:
//     the Phase 15 (V4) oracle (cost-by-project-oracle.mts);
//   - the Copilot CLI's events.jsonl: the JSONL parser the Phase 14 (V3) and
//     V4 oracles share (savings-oracle.mts).
//
// Rules, from the plan (§4.4, §4.5), not from the code:
//   - billed only: Copilot's own AI Credits (copilotUsageNanoAiu in the debug
//     logs, copilotUsage.totalNanoAiu in session.db and events.jsonl) / 1e9;
//     nothing estimated;
//   - whole-session known (constraint 6, https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/monthly-allowance.md D7): one turn
//     or request without billed credits makes the session unknown, never a
//     partial sum; a classic session's turns are its store rows plus any
//     logged turn past the store's last; each needs a logged request;
//   - attribution by start: a session counts wholly in the period whose days
//     hold its start, as a calendar day in the machine's zone; a session
//     without a readable start counts in no period;
//   - the period: from the reset day of this month, or of the last month
//     before the reset day, to the same day a month later.
import { agentHostTurns, alignLogTurns, type AgentHostStoreTurn } from "./cost-by-project-oracle.mjs";
import type { RawLine } from "./savings-oracle.mjs";
import { classifySubagentFileName, parseJsonlLines, summarizeSession } from "./subagent-spend-lib.mjs";

export type Harness = "local" | "agent-host";

export type UnknownReason =
  | "no-log" // classic: no main.jsonl
  | "no-turns" // classic: neither a store turn nor a logged turn
  | "turn-not-logged" // classic: a store turn the log has no placed turn for
  | "turn-without-request" // classic: a logged turn with no request
  | "request-without-credits" // classic: a main.jsonl request without billed credits
  | "run-missing" // classic: a subagent run the log names has no file
  | "run-without-credits" // classic: a subagent run's request without billed credits
  | "no-store" // Agent Host: no readable session.db
  | "turn-without-credits"; // Agent Host: a turn without billed credits

export interface OracleSession {
  id: string; // matched and hashed by the check, never printed
  harness: Harness;
  startMs: number | null; // null: no readable start, so in no period
  billed: number | null; // AI Credits; null: unknown, never 0
  unknownBecause: UnknownReason | null;
}

const NANO_PER_AI_CREDIT = 1e9;
const MS_PER_DAY = 86_400_000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isBilled = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const instantOf = (value: string | null): number | null => {
  const ms = value === null ? Number.NaN : Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
};

// ---------------------------------------------------------- classic Copilot Chat

// agentic-coding-explained.md §18.2 (owner decision 2026-11-14): a store
// session is Copilot Chat spend when it ran in the Chat panel, whatever agent
// name the store took from one of its requests; the legacy name match stays.
export function inClassicScope(row: { host_type: string | null; agent_name: string | null }): boolean {
  return row.host_type === "vscode" || row.agent_name === "GitHub Copilot Chat";
}

export interface ClassicInput {
  id: string;
  createdAt: string | null; // the store row's created_at: the session's start
  storePrompts: readonly (string | null)[]; // the store's turns, in turn_index order
  mainText: string | null; // main.jsonl; null: none
  files: readonly { name: string; text: string }[]; // the session folder's other .jsonl files
}

interface LogTurn {
  prompt: string | null;
  requests: number;
  uncredited: number;
}

// A request is an llm_request with numeric token counts (the SA18 scanner's rule).
function logTurnsOf(mainText: string): LogTurn[] {
  const turns: LogTurn[] = [];
  for (const event of parseJsonlLines(mainText).events) {
    const attrs = isRecord(event.attrs) ? event.attrs : {};
    if (event.type === "user_message") {
      turns.push({ prompt: typeof attrs.content === "string" ? attrs.content : null, requests: 0, uncredited: 0 });
      continue;
    }
    const turn = turns.at(-1);
    if (!turn || event.type !== "llm_request" || typeof attrs.inputTokens !== "number" || typeof attrs.outputTokens !== "number") continue;
    turn.requests += 1;
    if (!isBilled(attrs.copilotUsageNanoAiu)) turn.uncredited += 1;
  }
  return turns;
}

function classicUnknownReason(input: ClassicInput, runs: ReturnType<typeof summarizeSession>): UnknownReason | null {
  const turns = logTurnsOf(input.mainText!);
  const placement = alignLogTurns(
    turns.map((t) => t.prompt),
    input.storePrompts,
  );
  const placed = new Set(placement.filter((p): p is number => p !== null));
  const pastStore = [...placed].filter((p) => p >= input.storePrompts.length).length;
  if (input.storePrompts.length + pastStore === 0) return "no-turns";
  if (input.storePrompts.some((_, position) => !placed.has(position))) return "turn-not-logged";
  if (turns.some((t) => t.requests === 0)) return "turn-without-request";
  if (turns.some((t) => t.uncredited > 0)) return "request-without-credits";
  if (runs.danglingRefs > 0) return "run-missing";
  if (runs.requestsWithoutCredits > 0) return "run-without-credits";
  return null;
}

export function classicSession(input: ClassicInput): OracleSession {
  const base = { id: input.id, harness: "local" as const, startMs: instantOf(input.createdAt) };
  if (input.mainText === null) return { ...base, billed: null, unknownBecause: "no-log" };
  const summary = summarizeSession({ mainText: input.mainText, files: input.files.filter((f) => classifySubagentFileName(f.name) !== null) });
  const reason = classicUnknownReason(input, summary);
  return reason === null ? { ...base, billed: summary.mainAiCredits + summary.missingAiCredits, unknownBecause: null } : { ...base, billed: null, unknownBecause: reason };
}

// The first logged event's time: the edge report compares its period with
// the store's created_at (plan §10's risk row: the start source).
export function firstLogEventMs(mainText: string): number | null {
  const ts = parseJsonlLines(mainText).events.map((e) => e.ts).find((t): t is number => typeof t === "number" && Number.isFinite(t));
  return ts ?? null;
}

// ------------------------------------------------------------------- Agent Host

// A Copilot CLI session in VS Code's Agent Host catalog is a sessions_v2 row
// of provider 'copilotcli'; its id is the URI's path after the scheme,
// whichever scheme VS Code wrote (copilotcli:/, and ahp-session:/ in some
// VS Code Insiders builds), when that is one safe path segment.
export function agentHostIdOf(sessionUri: string): string | null {
  const match = /^[a-z][a-z0-9+.-]*:\/([0-9A-Za-z][0-9A-Za-z-]*)$/.exec(sessionUri);
  return match ? match[1]! : null;
}

export interface AgentHostInput {
  id: string;
  startTimeMs: number | null; // the catalog's start_time
  storeTurns: readonly AgentHostStoreTurn[] | null; // session.db's turns; null: none readable
}

// null: a chat opened but never sent (a session.db with no turns) is no session.
export function agentHostSession(input: AgentHostInput): OracleSession | null {
  const startMs = input.startTimeMs !== null && Number.isFinite(input.startTimeMs) ? input.startTimeMs : null;
  const base = { id: input.id, harness: "agent-host" as const, startMs };
  if (input.storeTurns === null) return { ...base, billed: null, unknownBecause: "no-store" };
  if (input.storeTurns.length === 0) return null;
  const { turns } = agentHostTurns({ session: { id: input.id, startedAt: startMs === null ? "" : new Date(startMs).toISOString(), folder: null }, storeTurns: input.storeTurns, events: null });
  if (turns.some((t) => typeof t.billed !== "number")) return { ...base, billed: null, unknownBecause: "turn-without-credits" };
  return { ...base, billed: turns.reduce((sum, t) => sum + (t.billed as number), 0), unknownBecause: null };
}

// The Copilot CLI's own record of the same spend: every model call's usage
// record, the sub-agents' included. null: no record, or one without credits.
export function eventLogCredits(events: readonly RawLine[]): number | null {
  const records = events.filter((e) => e.type === "session.usage_record");
  if (records.length === 0) return null;
  let nano = 0;
  for (const record of records) {
    const usage = isRecord(record.data) && isRecord(record.data.usage) ? record.data.usage : {};
    const total = isRecord(usage.copilotUsage) ? usage.copilotUsage.totalNanoAiu : undefined;
    if (!isBilled(total)) return null;
    nano += total;
  }
  return nano / NANO_PER_AI_CREDIT;
}

// ------------------------------------------------------------------- the period

export interface OraclePeriod {
  startKey: string;
  endKeyExclusive: string;
}

export function dayKeyIn(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const keyFrom = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);

// The period holding today's day key, or the one `back` whole periods before it.
export function periodBack(todayKey: string, resetDay: number, back: number): OraclePeriod {
  const [year, month, day] = todayKey.split("-").map(Number) as [number, number, number];
  const startMonth = (day >= resetDay ? month : month - 1) - back;
  return { startKey: keyFrom(year, startMonth, resetDay), endKeyExclusive: keyFrom(year, startMonth + 1, resetDay) };
}

export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / MS_PER_DAY);
}

// Noon UTC two weeks into the period: inside it in every zone (offsets stay
// within 14 hours and a period has at least 28 days).
export function instantInside(period: OraclePeriod): number {
  return Date.parse(`${period.startKey}T12:00:00Z`) + 14 * MS_PER_DAY;
}

// ------------------------------------------------------------------ the figures

export interface HarnessFigures {
  harness: Harness;
  known: number;
  total: number;
  used: number | null;
}

export interface OracleAllowance {
  state: "no-sessions" | "unknown" | "known";
  total: number;
  known: number;
  used: number | null; // unrounded; null: no session with cost data
  atLeast: boolean;
  countedSinceKey: string | undefined;
  byHarness: HarnessFigures[]; // a harness with no session in the period is left out
}

const HARNESSES: readonly Harness[] = ["local", "agent-host"];

function figuresOf(sessions: readonly OracleSession[]): { total: number; known: number; used: number | null } {
  const known = sessions.filter((s) => s.billed !== null);
  return { total: sessions.length, known: known.length, used: known.length === 0 ? null : known.reduce((sum, s) => sum + s.billed!, 0) };
}

export function allowanceIn(sessions: readonly OracleSession[], period: OraclePeriod, timeZone: string): OracleAllowance {
  const inPeriod: { session: OracleSession; dayKey: string }[] = [];
  for (const session of sessions) {
    if (session.startMs === null) continue;
    const dayKey = dayKeyIn(session.startMs, timeZone);
    if (dayKey >= period.startKey && dayKey < period.endKeyExclusive) inPeriod.push({ session, dayKey });
  }
  const all = figuresOf(inPeriod.map((s) => s.session));
  const byHarness = HARNESSES.map((harness) => ({ harness, ...figuresOf(inPeriod.filter((s) => s.session.harness === harness).map((s) => s.session)) })).filter((h) => h.total > 0);
  return {
    state: all.total === 0 ? "no-sessions" : all.used === null ? "unknown" : "known",
    ...all,
    atLeast: all.used !== null && all.known < all.total,
    countedSinceKey: inPeriod.map((s) => s.dayKey).sort()[0],
    byHarness,
  };
}
