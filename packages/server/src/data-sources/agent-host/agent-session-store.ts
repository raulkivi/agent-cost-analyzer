import type { DatabaseSync } from "node:sqlite";

export const NANO_AIU_PER_AI_CREDIT = 1_000_000_000;

export interface AgentHostTurnTokens {
  /** input tokens across the turn's models, cache hits included */
  input: number;
  cached: number;
  output: number;
}

export interface AgentHostTurnUsage {
  tokens: AgentHostTurnTokens | null;
  model: string | null;
  nanoAiu: number | null;
}

export interface AgentHostTurnRow {
  turnId: string;
  /** null: no turn_usage row, or the column held no JSON object */
  usage: AgentHostTurnUsage | null;
}

interface TurnDbRow {
  turn_id: string;
  usage: string | null;
}

// A missing table is a shape of the world (a session database from an older
// VS Code, or one whose projections never ran), not bad data — probe
// sqlite_master instead of letting the query throw.
function hasTable(db: DatabaseSync, name: string): boolean {
  return (
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined
  );
}

// JSON has no number-of-no-value, so "not a finite number" is decided here:
// JSON.stringify turns NaN/Infinity into null, and a hand-written row could
// still hold one.
function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Arrays are JSON values too; an array is never the shape these readers want.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// One entry per model the turn used (subagent calls included), so the turn's
// totals are the sum. A non-object entry carries nothing to add.
function sumTurnTokenTotals(totals: unknown): AgentHostTurnTokens | null {
  if (!Array.isArray(totals) || totals.length === 0) {
    return null;
  }
  let input = 0;
  let cached = 0;
  let output = 0;
  for (const entry of totals) {
    if (!isRecord(entry)) {
      continue;
    }
    input += toFiniteNumber(entry.inputTokens) ?? 0;
    cached += toFiniteNumber(entry.cachedTokens) ?? 0;
    output += toFiniteNumber(entry.outputTokens) ?? 0;
  }
  return { input, cached, output };
}

// The top-level model names the model that answered; the totals list also
// covers subagent models, so an entry is only the fallback.
function readModel(topModel: unknown, totals: unknown): string | null {
  if (typeof topModel === "string" && topModel !== "") {
    return topModel;
  }
  if (!Array.isArray(totals) || totals.length === 0) {
    return null;
  }
  const first = totals[0];
  if (!isRecord(first)) {
    return null;
  }
  const entryModel = first.model;
  return typeof entryModel === "string" && entryModel !== "" ? entryModel : null;
}

// `copilotUsage` covers the turn's subagent calls too; `sessionTotalNanoAiu`
// spans the whole session and `directCopilotUsage` only the direct calls.
function readNanoAiu(copilot: unknown): number | null {
  if (!isRecord(copilot)) {
    return null;
  }
  const total = toFiniteNumber(copilot.totalNanoAiu);
  return total === null || total < 0 ? null : total;
}

// The column is plain TEXT written by another process, so anything it holds
// is data to classify, not an error to raise.
function parseUsage(text: string | null): AgentHostTurnUsage | null {
  if (text === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const meta = isRecord(parsed._meta) ? parsed._meta : undefined;
  const totals = meta?.turnTokenTotals;
  return {
    tokens: sumTurnTokenTotals(totals),
    model: readModel(parsed.model, totals),
    nanoAiu: readNanoAiu(meta?.copilotUsage),
  };
}

export function readAgentHostTurns(db: DatabaseSync): AgentHostTurnRow[] {
  if (!hasTable(db, "turns")) {
    return [];
  }
  // rowid is the insertion order; the primary key is TEXT, so no natural
  // ordering to fall back on.
  const dbRows: TurnDbRow[] = hasTable(db, "turn_usage")
    ? (
        db
          .prepare(
            "SELECT t.id AS turn_id, u.usage AS usage FROM turns AS t " +
              "LEFT JOIN turn_usage AS u ON u.turn_id = t.id ORDER BY t.rowid",
          )
          .all() as unknown as TurnDbRow[]
      )
    : (
        db
          .prepare("SELECT id AS turn_id, NULL AS usage FROM turns ORDER BY rowid")
          .all() as unknown as TurnDbRow[]
      );

  return dbRows.map((dbRow) => ({
    turnId: dbRow.turn_id,
    usage: parseUsage(dbRow.usage),
  }));
}

export function readAgentHostSessionModel(db: DatabaseSync): string | null {
  if (!hasTable(db, "session_metadata")) {
    return null;
  }
  const row = db
    .prepare("SELECT value FROM session_metadata WHERE key = ?")
    .get("copilot.model") as unknown as { value: string } | undefined;
  if (row === undefined) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const id = parsed.id;
  return typeof id === "string" && id !== "" ? id : null;
}

// The value is plain text here, not the JSON the copilot.model row holds, so
// trimming is the whole read.
export function readAgentHostSessionTitle(db: DatabaseSync): string | null {
  if (!hasTable(db, "session_metadata")) {
    return null;
  }
  const row = db
    .prepare("SELECT value FROM session_metadata WHERE key = ?")
    .get("customTitle") as unknown as { value: string } | undefined;
  if (row === undefined) {
    return null;
  }
  const trimmed = row.value.trim();
  return trimmed === "" ? null : trimmed;
}

export function nanoAiuToAiCredits(nanoAiu: number): number {
  return nanoAiu / NANO_AIU_PER_AI_CREDIT;
}
