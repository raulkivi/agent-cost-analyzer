// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { formatCount, pluralize } from "./format.js";

// U5, session picker (docs/plans/mcp-apps.md §4.5, board SessionPicker.dc.html).
// Pure: formats a list_sessions result. A row has no cost: the tool returns
// none (owner answer Q8). The title is logged text, shown in the row and
// never part of a message (§6); the only message names the session id.

// The part of a list_sessions entry the picker reads. `repositoryKey` is
// there only when the server has attribution.
export interface SessionListEntry {
  id: string;
  title: string;
  startedAt?: string | undefined;
  turnCount: number;
  model: string;
  repositoryKey?: string | null | undefined;
}

export interface SessionListInput {
  total: number;
  sessions: SessionListEntry[];
}

export interface SessionRow {
  sessionId: string;
  title: string; // logged text: display only
  shortId: string;
  startedText?: string;
  turnsText: string;
  model: string;
  repository?: string;
}

export interface SessionListViewModel {
  summaryText: string;
  rows: SessionRow[];
  empty?: { title: string; hint: string };
}

const SHORT_ID_LENGTH = 8;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const pad = (value: number) => String(value).padStart(2, "0");

// "Nov 10, 14:12", in UTC so the text doesn't depend on the viewer's time zone.
function formatStart(iso: string | undefined): string | undefined {
  if (iso === undefined) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function rowOf(entry: SessionListEntry): SessionRow {
  const started = formatStart(entry.startedAt);
  return {
    sessionId: entry.id,
    title: entry.title.trim() === "" ? "Untitled session" : entry.title,
    shortId: entry.id.slice(0, SHORT_ID_LENGTH),
    ...(started === undefined ? {} : { startedText: started }),
    turnsText: pluralize(entry.turnCount, "turn"),
    model: entry.model,
    ...(typeof entry.repositoryKey === "string" && entry.repositoryKey !== "" ? { repository: entry.repositoryKey } : {}),
  };
}

export function toSessionListViewModel(list: SessionListInput): SessionListViewModel {
  const rows = list.sessions.map(rowOf);
  return {
    summaryText: `${formatCount(rows.length)} of ${formatCount(list.total)} sessions · most recent first`,
    rows,
    ...(rows.length === 0 ? { empty: { title: "No sessions match", hint: "Try a shorter search, a wider date range or another repository." } } : {}),
  };
}
