// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { type Currency, type SavingsAmount, type SavingsOpportunity } from "@agent-cost-analyzer/domain";
import { isFailedCall } from "../../tool-audit/outcome-tally.js";
import { currencyOf, NotAnalysedLedger, perWeek, sumAmount, unknownAmount, type PricedPart } from "../savings-amounts.js";
import type { DetectorResult, SavingsDetector, SavingsInput, SavingsSessionInput } from "../savings-detector.js";
import { savingsName } from "../savings-names.js";

// Phase 16 SR7 (docs/plans/savings-report.md §4 O5, §7): tool calls that
// failed again and again, from each session's tool-call audit, grouped across
// the window by the program (shell) or tool and the failure category. The
// audit reports the turns a failure sits in, not the rounds it cost, so no
// lower bound is claimed: the saving is the cost of those turns, an upper
// bound read from each turn's priced figure (low 0).

// One failure is an accident; the opportunity is the repeat.
const MIN_FAILED_CALLS = 2;
// Not a model's mistake to fix: the user said no, and a failing test or build
// is the work itself.
const NOT_A_MISTAKE = new Set(["user-rejected", "test-or-build-failure"]);

const NO_AUDIT = "No tool-call audit was built for this session.";
const NO_COSTS = "The session's turn costs were not given, so the cost of failed calls can't be priced.";
const NO_VERSION = "The turn's cost figure names no price version, so a priced saving can't be claimed from it.";

interface Occurrence {
  session: SavingsSessionInput;
  calls: number;
  turns: Set<number>;
}

interface Bucket {
  name: string;
  category: string;
  currency: Currency;
  occurrences: Map<SavingsSessionInput, Occurrence>;
}

export class FailedCallsDetector implements SavingsDetector {
  detect(input: SavingsInput): DetectorResult {
    const unusable = new NotAnalysedLedger();
    const priceFailures = new NotAnalysedLedger();
    const buckets = new Map<string, Bucket>();

    for (const session of input.sessions) {
      if (session.audit === undefined) {
        unusable.add(session, NO_AUDIT);
      } else if (session.audit.toolCallsUnavailableReason !== undefined) {
        unusable.add(session, session.audit.toolCallsUnavailableReason);
      } else if (!session.channel.known) {
        unusable.add(session, session.channel.reason);
      } else if (session.turnCosts === undefined) {
        unusable.add(session, NO_COSTS);
      } else {
        const currency = currencyOf(session.channel.channel);
        for (const { turnIndex, call } of session.audit.calls) {
          const category = call.outcome?.failureCategory ?? "unclassified";
          if (!isFailedCall(call) || NOT_A_MISTAKE.has(category)) continue;
          const name = savingsName(call.shell?.program ?? call.name);
          const key = `failed-tool-calls:${name}:${category}:${currency}`;
          const bucket = buckets.get(key) ?? { name, category, currency, occurrences: new Map() };
          const occurrence = bucket.occurrences.get(session) ?? { session, calls: 0, turns: new Set() };
          occurrence.calls += 1;
          occurrence.turns.add(turnIndex);
          bucket.occurrences.set(session, occurrence);
          buckets.set(key, bucket);
        }
      }
    }

    const opportunities = [...buckets.entries()]
      .filter(([, bucket]) => [...bucket.occurrences.values()].reduce((total, occurrence) => total + occurrence.calls, 0) >= MIN_FAILED_CALLS)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, bucket]) => this.opportunityOf(key, bucket, input, unusable, priceFailures));
    return { opportunities, notAnalysed: NotAnalysedLedger.report("failed-tool-calls", unusable, priceFailures) };
  }

  private opportunityOf(key: string, bucket: Bucket, input: SavingsInput, unusable: NotAnalysedLedger, priceFailures: NotAnalysedLedger): SavingsOpportunity {
    const parts: PricedPart[] = [];
    const failures = new Map<string, Set<SavingsSessionInput>>();
    for (const occurrence of bucket.occurrences.values()) {
      const turnParts: PricedPart[] = [];
      let failure: string | undefined;
      for (const turnIndex of occurrence.turns) {
        const figure = occurrence.session.turnCosts?.get(turnIndex);
        if (figure === undefined) failure = `The cost of turn ${turnIndex} is not known.`;
        else if (!figure.known) failure = figure.reason;
        else if (figure.currency !== bucket.currency) failure = `Priced in ${figure.currency}, not ${bucket.currency}.`;
        else if (figure.priceVersionIds === undefined) failure = NO_VERSION;
        else turnParts.push({ low: 0, high: figure.amount, priceVersionIds: figure.priceVersionIds });
        if (failure !== undefined) break;
      }
      // An upper bound that leaves a turn out is no upper bound: the session
      // is left out of the amount and counted in the coverage.
      if (failure === undefined) {
        parts.push(...turnParts);
      } else {
        failures.set(failure, (failures.get(failure) ?? new Set()).add(occurrence.session));
        priceFailures.add(occurrence.session, failure);
      }
    }
    const window: SavingsAmount = parts.length > 0 ? sumAmount(bucket.currency, parts, "upper-bound") : unknownAmount([...failures.keys()].sort()[0]!);
    const occurrences = [...bucket.occurrences.values()];
    const calls = occurrences.reduce((total, occurrence) => total + occurrence.calls, 0);
    return {
      key,
      kind: "failed-tool-calls",
      subject: bucket.name,
      sessions: occurrences.map(({ session }) => ({ providerId: session.providerId, sessionId: session.session.id })),
      // Rounds and per-turn tokens are not split by failure group in the audit.
      evidence: { sessions: occurrences.length, requests: null, tokens: null, occurrences: calls },
      perWeek: perWeek(window, input.window),
      perWindow: window,
      coverage: unusable.coverage(input.sessions.length, failures),
      actionParams: { name: bucket.name, calls, sessions: occurrences.length, category: bucket.category },
      inferred: false,
    };
  }
}
