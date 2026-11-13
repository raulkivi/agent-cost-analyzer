// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Currency, SavingsAmount, SavingsCoverage, SavingsNotAnalysed, SavingsOpportunityKind, SavingsWindow } from "@agent-cost-analyzer/domain";
import type { SavingsSessionInput } from "./savings-detector.js";

// Phase 16 SR5: the small arithmetic every detector shares, so no detector
// sums money or builds coverage its own way.

export interface PricedPart {
  low: number;
  high: number;
  priceVersionIds: readonly string[];
}

export function unknownAmount(reason: string): SavingsAmount {
  return { known: false, reason };
}

// The parts' sum as a priced range, or an upper bound (low 0) when the saving
// is not always avoidable.
export function sumAmount(currency: Currency, parts: readonly PricedPart[], label: "range" | "upper-bound"): SavingsAmount {
  if (parts.length === 0) return unknownAmount("No session could be priced.");
  return {
    known: true,
    currency,
    low: label === "upper-bound" ? 0 : parts.reduce((total, part) => total + part.low, 0),
    high: parts.reduce((total, part) => total + part.high, 0),
    basis: "priced",
    label,
    priceVersionIds: [...new Set(parts.flatMap((part) => part.priceVersionIds))].sort(),
  };
}

// D8: the total over the window ÷ weeks in the window.
export function perWeek(amount: SavingsAmount, window: SavingsWindow): SavingsAmount {
  if (!amount.known) return amount;
  const weeks = window.days / 7;
  return { ...amount, low: amount.low / weeks, high: amount.high / weeks };
}

export function currencyOf(channel: string): Currency {
  return channel === "github-copilot" ? "AI_CREDITS" : "USD";
}

// Sessions a detector could not use, each once, by reason.
export class NotAnalysedLedger {
  private readonly byReason = new Map<string, { providerId: string; reason: string; sessions: Set<SavingsSessionInput> }>();

  add(session: SavingsSessionInput, reason: string): void {
    const key = `${session.providerId}\u0000${reason}`;
    const entry = this.byReason.get(key) ?? { providerId: session.providerId, reason, sessions: new Set() };
    entry.sessions.add(session);
    this.byReason.set(key, entry);
  }

  // The sessions by reason, to count them against one opportunity's coverage.
  sessionsByReason(): Map<string, Set<SavingsSessionInput>> {
    const result = new Map<string, Set<SavingsSessionInput>>();
    for (const entry of this.byReason.values()) {
      result.set(entry.reason, new Set([...(result.get(entry.reason) ?? []), ...entry.sessions]));
    }
    return result;
  }

  // The report-level list over several ledgers: a session counts once per
  // provider and reason.
  static report(kind: SavingsOpportunityKind, ...ledgers: readonly NotAnalysedLedger[]): SavingsNotAnalysed[] {
    const merged = new NotAnalysedLedger();
    for (const ledger of ledgers) {
      for (const entry of ledger.byReason.values()) entry.sessions.forEach((session) => merged.add(session, entry.reason));
    }
    return merged.report(kind);
  }

  report(kind: SavingsOpportunityKind): SavingsNotAnalysed[] {
    return [...this.byReason.values()]
      .map((entry) => ({ kind, providerId: entry.providerId, reason: entry.reason, sessions: entry.sessions.size }))
      .sort((a, b) => a.providerId.localeCompare(b.providerId) || a.reason.localeCompare(b.reason));
  }

  // Coverage of one opportunity: the window's sessions, less those listed
  // here and those in `extra` (sessions this opportunity alone could not use).
  coverage(total: number, extra?: ReadonlyMap<string, Set<SavingsSessionInput>>): SavingsCoverage {
    const notAnalysed = [...this.byReason.values()]
      .map((entry) => ({ reason: entry.reason, sessions: entry.sessions.size }))
      .sort((a, b) => a.reason.localeCompare(b.reason));
    const seen = new Set<SavingsSessionInput>([...this.byReason.values()].flatMap((entry) => [...entry.sessions]));
    for (const [reason, sessions] of extra ?? []) {
      const fresh = [...sessions].filter((session) => !seen.has(session));
      fresh.forEach((session) => seen.add(session));
      if (fresh.length > 0) notAnalysed.push({ reason, sessions: fresh.length });
    }
    return { sessionsInWindow: total, sessionsAnalysed: total - seen.size, notAnalysed };
  }
}
