// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { InsightSessionRow, SavingsSessionRef } from "@agent-cost-analyzer/domain";

// V25 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/savings-increment-3.md §5, D24): a session's title is looked
// up here, in the browser, from the insights dataset the Dashboard also uses.
// It never goes into a report, an RPC answer or a tool result (D19).

export type SessionTitleOf = (session: Pick<SavingsSessionRef, "providerId" | "sessionId">) => string | undefined;

export const MAX_TITLE_LENGTH = 120;
const FORMAT_CHARACTERS = /\p{Cf}/gu; // bidi marks, isolates, zero-width
const CONTROL_OR_SPACE_RUN = /[\p{Cc}\p{Z}\s]+/gu;

// One line, control and bidi characters out, at most 120 code points
// (threat-model §6.1's free-text title rule). Markup stays as text: React
// escapes it, so stripping tags would only change what the title says.
export function titleText(title: string): string {
  const folded = title.replace(FORMAT_CHARACTERS, "").replace(CONTROL_OR_SPACE_RUN, " ").trim();
  return [...folded].slice(0, MAX_TITLE_LENGTH).join("").trim();
}

export function sessionTitleLookup(rows: readonly InsightSessionRow[] | undefined): SessionTitleOf {
  const titles = new Map<string, string>();
  for (const row of rows ?? []) {
    const title = titleText(row.title);
    // "Session <id>" is the dataset's stand-in for an untitled session (an Agent
    // Host title that only echoes the first prompt is dropped); showing it would
    // repeat the id as a title.
    if (title !== "" && title !== `Session ${row.sessionId}`) titles.set(row.key, title);
  }
  return ({ providerId, sessionId }) => titles.get(`${providerId}:${sessionId}`);
}
