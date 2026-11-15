// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Session } from "../session.js";

// Per-session AI Credits for a total: the extension's today item and the
// monthly allowance gauge in both products.

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
