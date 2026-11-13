// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Session } from "@agent-cost-analyzer/domain";
import { dayKeyOf } from "../time/local-time.js";

// Per-session AI Credits shared by today's item and the monthly allowance
// gauge (step 10.21, plan §3.2). Pure and free of `vscode`.

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

// A session's AI Credits when they count for a total, undefined otherwise.
export type CreditsOf = (session: Session) => number | undefined;

export const knownCredits: CreditsOf = (session) => (session.costAiCredits.known ? session.costAiCredits.value : undefined);

// Only what GitHub billed: a local-tokenizer estimate is not a bill.
export const billedCredits: CreditsOf = (session) =>
  session.costAiCredits.known && session.costAiCredits.estimated !== true ? session.costAiCredits.value : undefined;

export interface KnownSum {
  known: number; // sessions whose credits count
  total: number;
}

// An unknown session is never a 0: it is left out of the total and of `known`.
export function knownSum(sessions: Session[], creditsOf: CreditsOf = knownCredits): KnownSum {
  let known = 0;
  let total = 0;
  for (const session of sessions) {
    const credits = creditsOf(session);
    if (credits !== undefined) {
      known += 1;
      total += credits;
    }
  }
  return { known, total };
}
