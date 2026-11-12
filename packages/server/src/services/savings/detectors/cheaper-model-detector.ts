// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { MAX_SAVINGS_NAME_LENGTH, toUsd, type SavingsAmount, type SavingsOpportunity, type SessionReplay } from "@agent-cost-analyzer/domain";
import type { ReplayRequest, ReplayResult } from "../../session-replay/session-replay-service.js";
import { NotAnalysedLedger, perWeek, unknownAmount } from "../savings-amounts.js";
import type { DetectorResult, SavingsDetector, SavingsInput, SavingsSessionInput } from "../savings-detector.js";

// Phase 16 SR8 (docs/plans/savings-report.md §4 O6, §7, D3, D5): what the
// most expensive sessions would have cost on a cheaper model of the same
// vendor, from a Phase 14 replay. Every figure is Simulated: it assumes the
// same conversation (A1), and the other model would not have answered the same
// way. So the saving is one estimate, never a range or an upper bound, always
// carries the replay's self-check, coverage and assumptions, and the report
// keeps it out of the ranked list (savingsReportSchema enforces it).

// D5: the top 5 sessions by cost, on up to 3 cheaper models each.
export const MAX_REPLAYED_SESSIONS = 5;
export const MAX_CHEAPER_MODELS = 3;
// A provider that can't replay fails fast, but a window of them must not turn
// into a replay per session.
const MAX_ATTEMPTED_SESSIONS = MAX_REPLAYED_SESSIONS * 4;

// The replay service's one method this needs (SessionReplayService satisfies
// it): a session on one model, with its self-check, coverage and assumptions.
export interface ReplayComparer {
  replay(request: ReplayRequest): Promise<ReplayResult<SessionReplay>>;
}

// D5: the models of the same vendor that are documented as cheaper than this
// one at list price, nearest first.
export interface CheaperModelCandidates {
  candidatesFor(model: string): readonly string[];
}

// The price versions a replay's simulated cost used. The replay doesn't name
// them, so the composition looks them up (a Simulated amount shows them, §7);
// none found makes the amount unknown rather than unsourced.
export type ReplayPriceVersions = (replay: SessionReplay) => readonly string[];

export interface CheaperModelDeps {
  comparer: ReplayComparer;
  candidates: CheaperModelCandidates;
  priceVersions: ReplayPriceVersions;
}

const NO_TURN_COSTS = "The session's turn costs were not given, so it can't be ranked by cost.";
const NO_KNOWN_COST = "No turn's cost is known, so the session can't be ranked by cost.";
const NO_CANDIDATES = "No cheaper model of the same vendor is documented for this model.";
const NO_SELF_CHECK = "The replay's own model has no vendor profile to check it against the log, so its figures can't be trusted.";
const NO_SIMULATED_COST = "The replay could not price this model.";
const NO_PRICE_VERSION = "The replay names no price version, so its simulated amount can't be sourced.";
const OUTSIDE_TOP = `Not among the ${MAX_REPLAYED_SESSIONS} most expensive replayable sessions.`;

const percent = (part: number, whole: number): number => Math.round((part / whole) * 100);

interface Ranked {
  session: SavingsSessionInput;
  costUsd: number;
}

export class CheaperModelDetector implements SavingsDetector {
  constructor(private readonly deps: CheaperModelDeps) {}

  async detect(input: SavingsInput): Promise<DetectorResult> {
    const unusable = new NotAnalysedLedger();
    const ranked: Ranked[] = [];
    for (const session of input.sessions) {
      if (session.turnCosts === undefined) {
        unusable.add(session, NO_TURN_COSTS);
        continue;
      }
      const costs = [...session.turnCosts.values()].map((figure) => toUsd(figure)).filter((value): value is number => value !== null);
      if (costs.length === 0) {
        unusable.add(session, NO_KNOWN_COST);
        continue;
      }
      ranked.push({ session, costUsd: costs.reduce((total, value) => total + value, 0) });
    }
    ranked.sort((a, b) => b.costUsd - a.costUsd);

    const opportunities: SavingsOpportunity[] = [];
    const replayed: SavingsSessionInput[] = [];
    const outside: SavingsSessionInput[] = [];
    let attempted = 0;
    for (const { session } of ranked) {
      if (replayed.length >= MAX_REPLAYED_SESSIONS || attempted >= MAX_ATTEMPTED_SESSIONS) {
        outside.push(session);
        continue;
      }
      const models = this.deps.candidates.candidatesFor(session.session.model).slice(0, MAX_CHEAPER_MODELS);
      if (models.length === 0) {
        unusable.add(session, NO_CANDIDATES);
        continue;
      }
      attempted += 1;
      const found = await this.replaySession(session, models, input, unusable);
      if (found === null) continue;
      replayed.push(session);
      opportunities.push(...found);
    }

    // Counted in each opportunity's coverage: the sessions left unlooked at.
    const outsideLedger = new NotAnalysedLedger();
    outside.forEach((session) => outsideLedger.add(session, OUTSIDE_TOP));
    const extra = outsideLedger.sessionsByReason();
    const withCoverage = opportunities.map((opportunity) => ({ ...opportunity, coverage: unusable.coverage(input.sessions.length, extra) }));
    return { opportunities: withCoverage, notAnalysed: unusable.report("cheaper-model") };
  }

  // null when the session could not be replayed at all (it takes no place of
  // the top 5); else the opportunities of the models that would cost less.
  private async replaySession(session: SavingsSessionInput, models: readonly string[], input: SavingsInput, unusable: NotAnalysedLedger): Promise<SavingsOpportunity[] | null> {
    const found: SavingsOpportunity[] = [];
    let replayed = false;
    for (const model of models) {
      const result = await this.deps.comparer.replay({ sessionId: session.session.id, providerId: session.providerId, model });
      if (result.status === "unknown-session" || result.status === "not-replayable") {
        // The session itself can't be replayed: its other models won't be either.
        unusable.add(session, result.status === "unknown-session" ? "The provider no longer has this session." : result.reason);
        return replayed ? found : null;
      }
      if (result.status === "unknown-model") {
        unusable.add(session, result.reason);
        continue;
      }
      replayed = true;
      const opportunity = this.opportunityOf(session, result.value, input, unusable);
      if (opportunity !== null) found.push(opportunity);
    }
    return replayed ? found : null;
  }

  private opportunityOf(session: SavingsSessionInput, replay: SessionReplay, input: SavingsInput, unusable: NotAnalysedLedger): SavingsOpportunity | null {
    const { selfCheck, totals } = replay;
    if (selfCheck === null || selfCheck.requests === 0) {
      unusable.add(session, NO_SELF_CHECK);
      return null;
    }
    const { measured, simulated, difference } = totals;
    if (difference === null || measured.value === null || simulated.value === null) {
      unusable.add(session, replay.pricing.reason ?? NO_SIMULATED_COST);
      return null;
    }
    // The difference is simulated − measured: a saving is a negative one.
    const saving = -difference;
    if (saving <= 0 || measured.value <= 0) return null;

    const versions = this.deps.priceVersions(replay);
    const window: SavingsAmount =
      versions.length === 0
        ? unknownAmount(NO_PRICE_VERSION)
        : { known: true, currency: replay.currency, low: saving, high: saving, basis: "simulated", label: "simulated", priceVersionIds: [...versions] };
    return {
      key: `cheaper-model:${session.session.id}:${replay.model}`.slice(0, MAX_SAVINGS_NAME_LENGTH * 2),
      kind: "cheaper-model",
      subject: replay.model.slice(0, MAX_SAVINGS_NAME_LENGTH),
      sessions: [{ providerId: session.providerId, sessionId: session.session.id }],
      evidence: { sessions: 1, requests: replay.coverage.replayedRequests, tokens: null, occurrences: replay.coverage.replayedTurns },
      perWeek: perWeek(window, input.window),
      perWindow: window,
      // Replaced with the window's coverage once every session is replayed.
      coverage: { sessionsInWindow: 0, sessionsAnalysed: 0, notAnalysed: [] },
      actionParams: { model: replay.model, percent: percent(simulated.value, measured.value), matchPercent: percent(selfCheck.matching, selfCheck.requests) },
      inferred: false,
      simulation: {
        model: replay.model.slice(0, MAX_SAVINGS_NAME_LENGTH),
        selfCheck: { requests: selfCheck.requests, matching: selfCheck.matching, passed: selfCheck.passed },
        coverage: { turns: replay.coverage.turns, replayedTurns: replay.coverage.replayedTurns, requests: replay.coverage.requests, replayedRequests: replay.coverage.replayedRequests },
        assumptions: replay.assumptions.map(({ id, text }) => ({ id, text })),
      },
    };
  }
}
