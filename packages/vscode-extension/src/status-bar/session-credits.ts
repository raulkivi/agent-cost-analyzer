// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { dayKeyOf, type Session } from "@agent-cost-analyzer/domain";

// Which day a session belongs to, for today's item (step 10.21, plan §3.2).
// Pure and free of `vscode`. The sum (`knownSum`, `knownCredits`,
// `billedCredits`) is the domain's, shared with the monthly allowance.

// The day a session started, "YYYY-MM-DD" in the user's zone; undefined when
// the start is missing or unreadable, so the session belongs to no day.
export function sessionDayKey(session: Session, timeZone: string | undefined): string | undefined {
  if (session.startedAt === undefined) {
    return undefined;
  }
  const start = Date.parse(session.startedAt);
  return Number.isNaN(start) ? undefined : dayKeyOf(new Date(start), timeZone);
}

export function sessionStartedOn(session: Session, dayKey: string, timeZone: string | undefined): boolean {
  return sessionDayKey(session, timeZone) === dayKey;
}
