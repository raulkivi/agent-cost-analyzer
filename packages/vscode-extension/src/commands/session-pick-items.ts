// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Session } from "@agent-cost-analyzer/domain";
import { identityTranslate, type Translate } from "../l10n/localize.js";
import { formatAiCredits, startOf } from "../sidebar/sessions-tree-model.js";
import { dayKeyOf, timeOfDayOf } from "../time/local-time.js";

// One row of the Open Session picker; the shape of vscode.QuickPickItem plus
// the id the row stands for.
export interface SessionPickItem {
  // The session title: what a user (or the MCP App view's copy button)
  // searches by.
  label: string;
  // "2026-11-07 14:03 · copilot · 1.20 AI Credits".
  description: string;
  // The session id, so a pasted id matches too.
  detail: string;
  sessionId: string;
}

function descriptionOf(session: Session, timeZone: string | undefined, t: Translate): string {
  const start = startOf(session);
  const parts = [
    start ? `${dayKeyOf(start, timeZone)} ${timeOfDayOf(start, timeZone)}` : t("start time unknown"),
    ...(session.providerId ? [session.providerId] : []),
    // Never a 0 for a cost that isn't known (architecture constraint 6).
    session.costAiCredits.known ? t("{0} AI Credits", formatAiCredits(session.costAiCredits.value)) : t("AI Credits: Unknown"),
  ];
  return parts.join(" · ");
}

// The picker rows for the sessions, newest first; sessions with no valid
// start time come last, in their input order. Pure and free of `vscode`.
export function buildSessionPickItems(sessions: Session[], t: Translate = identityTranslate, timeZone?: string): SessionPickItem[] {
  return sessions
    .map((session) => ({ session, time: startOf(session)?.getTime() }))
    .sort((a, b) => (a.time === undefined ? 1 : 0) - (b.time === undefined ? 1 : 0) || (b.time ?? 0) - (a.time ?? 0))
    .map(({ session }) => ({
      label: session.title,
      description: descriptionOf(session, timeZone, t),
      detail: session.id,
      sessionId: session.id,
    }));
}
