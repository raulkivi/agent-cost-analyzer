// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Harness, PromptChangeMarker, RequestTrace, TraceRequest } from "@agent-cost-analyzer/domain";
import { idleMinutes, requestInputTotal } from "../session-replay/request-trace-scripter.js";

// Phase 16 SR4 (docs/plans/savings-report.md §4 O2–O4, §12 D7, §15): which
// requests of one session's request trace lost the cache, and why. Pure:
// the trace, the vendors' caching rules and, where a log records them, what
// changed in each prompt, in; classified breaks out. Pricing them is SR6's.
//
// A break (D7): the lost tokens, min(previous prompt, this prompt) − this
// request's cache read, reach both the vendor's minimum cacheable tokens and
// half the previous prompt. A prompt is uncached + cache read + cache write;
// unknown writes are already inside uncached input (plan A4), so the total
// is the same either way.
//
// Classes, first match wins:
//   - a compaction or clear event: intended, listed apart, never a break;
//   - the model changed (from the ids, as the replay scripter reads it: the
//     Claude Code trace gives compaction the event when both happen);
//   - the gap from the previous request is longer than the cache lifetime:
//     idle expiry;
//   - else unexplained, with the cause where the log records one (O3).
// A request whose vendor documents no minimum or lifetime can't be classed;
// it is listed with the reason, never counted as no break (constraint 6).

// What the vendor documents, for the model a request ran on.
export type CacheRules =
  | {
      known: true;
      minCacheableTokens: number;
      // Fixed lifetimes have min = max; a documented range keeps both.
      lifetime: { minMinutes: number; maxMinutes: number };
      // The longer lifetime a request can ask for (Anthropic's 1-hour option).
      extendedLifetimeMinutes?: number;
    }
  | { known: false; reason: string };

export type CacheRulesLookup = (model: string) => CacheRules;

// What changed in a request's prompt (the domain type, request-trace.ts): each
// provider maps its own signals (tools-file hash, shapeHash, instructions
// attachment) onto it.
export type { PromptChangeMarker };

export type PromptChangeKind = "tools-changed" | "instructions-changed" | "system-prompt-changed";

export type BreakCause = { recorded: true; changes: PromptChangeKind[] } | { recorded: false; reason: string };

export const NOT_RECORDED_REASON =
  "Not recorded in the log; usually an instructions file or the tool list changed, or the provider evicted the cache.";
export const NO_CHANGE_RECORDED_REASON =
  "The log records no change to the tools, system prompt or instructions before this request; the provider may have evicted the cache.";

export type CacheBreakCaveat =
  | "start-to-start-gap"
  | "gap-within-turn"
  | "gap-within-lifetime-range"
  | "lifetime-assumed"
  | "lifetime-also-exceeded"
  | "prompt-shrank"
  | "prompt-also-changed";

// Fixed sentences for the view model; codes stay in the data.
export const CACHE_BREAK_CAVEAT_TEXT: Readonly<Record<CacheBreakCaveat, string>> = {
  "start-to-start-gap":
    "The gap runs from the previous request's logged time to this one's, so it includes the previous response and any tool runs between them; you may have been away for less time.",
  "gap-within-turn": "Both requests are in one turn: the gap was the agent working (a long response or tool run), not a pause between your prompts.",
  "gap-within-lifetime-range": "The vendor documents a range for the cache lifetime and the gap falls inside it, so the cache may or may not have expired.",
  "lifetime-assumed":
    "The cache lifetime is the harness's usual 1-hour option (Claude Code asks for it); this session's log doesn't record which lifetime its writes used.",
  "lifetime-also-exceeded": "The gap also exceeded the previous model's cache lifetime, so the cache would have expired without the switch.",
  "prompt-shrank": "The prompt was smaller than the previous one: messages were removed, perhaps by a compaction, rewind or edit the log doesn't mark.",
  "prompt-also-changed": "The log also records a change to the tools, system prompt or instructions before this request.",
};

const CAVEAT_ORDER: readonly CacheBreakCaveat[] = Object.keys(CACHE_BREAK_CAVEAT_TEXT) as CacheBreakCaveat[];

export interface CacheLifetime {
  minMinutes: number;
  maxMinutes: number;
  // vendor-default: the vendor's lifetime; recorded-1h-writes: a request
  // before this one recorded 1-hour writes; harness-default: assumed from
  // the harness (inferred, with the lifetime-assumed caveat).
  basis: "vendor-default" | "recorded-1h-writes" | "harness-default";
}

export interface BreakFigures {
  requestIndex: number;
  turnIndex: number;
  startedAt: string;
  model: string;
  previousModel: string;
  // Start to start (see the start-to-start-gap caveat).
  gapMinutes: number;
  previousPromptTokens: number;
  promptTokens: number;
  cacheRead: number;
  lostTokens: number;
  // False: the log has no cache writes for this request, so the lost tokens
  // were billed as a write or as plain input, which the log doesn't say.
  cacheWriteRecorded: boolean;
  caveats: CacheBreakCaveat[];
}

export type CacheBreak =
  | (BreakFigures & { class: "idle-expiry"; lifetime: CacheLifetime })
  | (BreakFigures & { class: "model-switch" })
  | (BreakFigures & { class: "unexplained"; lifetime: CacheLifetime; cause: BreakCause });

export type CacheBreakClass = CacheBreak["class"];

// A compaction or clear the log marks: the prompt was rebuilt on purpose.
export type IntendedReset = BreakFigures & { event: "compaction" | "clear" };

export interface UncheckedRequest {
  requestIndex: number;
  turnIndex: number;
  model: string;
  lostTokens: number;
  reason: string;
}

export interface CacheBreakClassification {
  sessionId: string;
  providerId: string;
  harness: Harness;
  requests: number;
  breaks: CacheBreak[];
  intended: IntendedReset[];
  unchecked: UncheckedRequest[];
}

export interface CacheBreakInput {
  trace: RequestTrace;
  rules: CacheRulesLookup;
  // By request index; a request with no entry has no recorded signal.
  promptChanges?: ReadonlyMap<number, PromptChangeMarker>;
}

// Harnesses that ask for the longer lifetime on their own (as the replay's
// simulate-scenario assumes: Claude Code's logs show it on 186 of 188 sessions).
const HARNESSES_WITH_EXTENDED_LIFETIME: readonly Harness[] = ["claude-code"];

const ordered = (caveats: Set<CacheBreakCaveat>): CacheBreakCaveat[] => CAVEAT_ORDER.filter((caveat) => caveats.has(caveat));

export function causeOf(marker: PromptChangeMarker | undefined): BreakCause {
  if (marker === undefined) return { recorded: false, reason: NOT_RECORDED_REASON };
  const changes: PromptChangeKind[] = [];
  if (marker.tools === true) changes.push("tools-changed");
  // Instructions are part of the system prompt, so they explain its change.
  if (marker.instructions === true) changes.push("instructions-changed");
  else if (marker.systemPrompt === true) changes.push("system-prompt-changed");
  if (changes.length > 0) return { recorded: true, changes };
  const allRecorded = marker.tools === false && marker.systemPrompt === false && marker.instructions === false;
  return { recorded: false, reason: allRecorded ? NO_CHANGE_RECORDED_REASON : NOT_RECORDED_REASON };
}

const changed = (marker: PromptChangeMarker | undefined): boolean => causeOf(marker).recorded;

class SessionLifetimes {
  private readonly firstExtendedWrite: number;

  constructor(
    private readonly trace: RequestTrace,
    private readonly rules: CacheRulesLookup,
  ) {
    this.firstExtendedWrite = trace.requests.findIndex((request) => (request.extendedCacheWrite ?? 0) > 0);
  }

  // The lifetime of the cache the request at `position` hoped to read: the
  // one the previous request's model wrote. Null when it isn't documented.
  before(position: number): CacheLifetime | null {
    const previous = this.trace.requests[position - 1]!;
    const rules = this.rules(previous.model);
    if (!rules.known) return null;
    const extended = rules.extendedLifetimeMinutes;
    if (extended !== undefined) {
      if (this.firstExtendedWrite >= 0 && this.firstExtendedWrite < position) {
        return { minMinutes: extended, maxMinutes: extended, basis: "recorded-1h-writes" };
      }
      if (HARNESSES_WITH_EXTENDED_LIFETIME.includes(this.trace.harness)) {
        return { minMinutes: extended, maxMinutes: extended, basis: "harness-default" };
      }
    }
    return { ...rules.lifetime, basis: "vendor-default" };
  }
}

function figuresOf(request: TraceRequest, previous: TraceRequest): Omit<BreakFigures, "caveats"> {
  const previousPromptTokens = requestInputTotal(previous);
  const promptTokens = requestInputTotal(request);
  return {
    requestIndex: request.index,
    turnIndex: request.turnIndex,
    startedAt: request.startedAt,
    model: request.model,
    previousModel: previous.model,
    gapMinutes: idleMinutes(request, previous),
    previousPromptTokens,
    promptTokens,
    cacheRead: request.cacheRead,
    lostTokens: Math.max(0, Math.min(previousPromptTokens, promptTokens) - request.cacheRead),
    cacheWriteRecorded: request.cacheWrite !== null,
  };
}

// D7's half rule; the minimum is checked once the rules are known.
const lostHalf = (figures: Omit<BreakFigures, "caveats">): boolean => figures.lostTokens > 0 && 2 * figures.lostTokens >= figures.previousPromptTokens;

export function classifyCacheBreaks({ trace, rules, promptChanges }: CacheBreakInput): CacheBreakClassification {
  const lifetimes = new SessionLifetimes(trace, rules);
  const result: CacheBreakClassification = {
    sessionId: trace.sessionId,
    providerId: trace.providerId,
    harness: trace.harness,
    requests: trace.requests.length,
    breaks: [],
    intended: [],
    unchecked: [],
  };

  trace.requests.forEach((request, position) => {
    if (position === 0) return;
    const figures = figuresOf(request, trace.requests[position - 1]!);
    if (!lostHalf(figures)) return;
    const own = rules(request.model);
    if (request.event === "compaction" || request.event === "clear") {
      if (!own.known || figures.lostTokens >= own.minCacheableTokens) {
        result.intended.push({ ...figures, caveats: [], event: request.event });
      }
      return;
    }
    const caveats = new Set<CacheBreakCaveat>();
    // Unmarked: the event above would have explained it.
    if (figures.promptTokens < figures.previousPromptTokens) caveats.add("prompt-shrank");
    if (!own.known) {
      result.unchecked.push({ requestIndex: figures.requestIndex, turnIndex: figures.turnIndex, model: figures.model, lostTokens: figures.lostTokens, reason: own.reason });
      return;
    }
    if (figures.lostTokens < own.minCacheableTokens) return;

    // The previous model's lifetime: null only when its rules are unknown,
    // which with the same model was ruled out just above.
    const lifetime = lifetimes.before(position);
    if (figures.previousModel !== figures.model || lifetime === null) {
      if (lifetime !== null && figures.gapMinutes > lifetime.minMinutes) caveats.add("lifetime-also-exceeded");
      result.breaks.push({ ...figures, caveats: ordered(caveats), class: "model-switch" });
      return;
    }
    const known = lifetime;
    if (known.basis === "harness-default") caveats.add("lifetime-assumed");
    const marker = promptChanges?.get(request.index);
    if (figures.gapMinutes > known.minMinutes) {
      caveats.add("start-to-start-gap");
      if (request.turnIndex === trace.requests[position - 1]!.turnIndex) caveats.add("gap-within-turn");
      if (figures.gapMinutes <= known.maxMinutes) caveats.add("gap-within-lifetime-range");
      if (changed(marker)) caveats.add("prompt-also-changed");
      result.breaks.push({ ...figures, caveats: ordered(caveats), class: "idle-expiry", lifetime: known });
      return;
    }
    result.breaks.push({ ...figures, caveats: ordered(caveats), class: "unexplained", lifetime: known, cause: causeOf(marker) });
  });
  return result;
}

// For callers that want the classifier as an injectable collaborator.
export class CacheBreakClassifier {
  constructor(private readonly rules: CacheRulesLookup) {}

  classify(trace: RequestTrace, promptChanges?: ReadonlyMap<number, PromptChangeMarker>): CacheBreakClassification {
    return classifyCacheBreaks({ trace, rules: this.rules, ...(promptChanges ? { promptChanges } : {}) });
  }
}
