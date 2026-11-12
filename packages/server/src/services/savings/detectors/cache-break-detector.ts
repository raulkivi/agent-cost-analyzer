// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Currency, SavingsActionParams, SavingsAmount, SavingsOpportunity, SavingsOpportunityKind } from "@agent-cost-analyzer/domain";
import { pricingPolicyFor } from "../../pricing/turn-cost-figures.js";
import { classifyCacheBreaks, type CacheBreak, type PromptChangeKind } from "../cache-break-classifier.js";
import { currencyOf, NotAnalysedLedger, perWeek, sumAmount, unknownAmount, type PricedPart } from "../savings-amounts.js";
import type { DetectorResult, SavingsDetector, SavingsInput, SavingsSessionInput } from "../savings-detector.js";

// Phase 16 SR6 (docs/plans/savings-report.md §4 O2–O4, §7): the cache breaks
// SR4 classifies, as opportunities. A break is not always avoidable (an
// editor session left overnight), so each is an upper bound with low 0: the
// lost tokens billed as a cache write or plain input, less what a cache read
// would have cost. Compactions are intended and never reach here.

const NO_TRACE = "This provider's log records no request trace, so cache breaks can't be found.";
const EMPTY_TRACE = "The request trace has no requests.";

const CAUSE_TEXT: Readonly<Record<PromptChangeKind, string>> = {
  "tools-changed": "Tool list changed",
  "instructions-changed": "Instructions changed",
  "system-prompt-changed": "System prompt changed, cause not recorded",
};

interface Found {
  session: SavingsSessionInput;
  channel: string;
  cacheBreak: CacheBreak;
}

interface GroupDescriptor {
  kind: Extract<SavingsOpportunityKind, "idle-cache-expiry" | "unexplained-cache-break" | "model-switch">;
  discriminator: string;
  subject: string;
}

function describeBreak(cacheBreak: CacheBreak): GroupDescriptor {
  switch (cacheBreak.class) {
    case "idle-expiry":
      return { kind: "idle-cache-expiry", discriminator: String(cacheBreak.lifetime.minMinutes), subject: `Idle longer than ${cacheBreak.lifetime.minMinutes} minutes` };
    case "model-switch":
      return { kind: "model-switch", discriminator: "", subject: "Model switches" };
    case "unexplained": {
      const cause = cacheBreak.cause;
      if (!cause.recorded) return { kind: "unexplained-cache-break", discriminator: "unrecorded", subject: "Cause not recorded" };
      const text = cause.changes.map((change, position) => (position === 0 ? CAUSE_TEXT[change] : CAUSE_TEXT[change].charAt(0).toLowerCase() + CAUSE_TEXT[change].slice(1)));
      return { kind: "unexplained-cache-break", discriminator: cause.changes.join("+"), subject: text.join(" and ") };
    }
  }
}

export class CacheBreakDetector implements SavingsDetector {
  detect(input: SavingsInput): DetectorResult {
    const unusable = new NotAnalysedLedger();
    const partial = new NotAnalysedLedger();
    const priceFailures = new NotAnalysedLedger();
    const groups = new Map<string, { descriptor: GroupDescriptor; currency: Currency; found: Found[] }>();

    for (const session of input.sessions) {
      if (session.trace === undefined) {
        unusable.add(session, session.traceUnavailableReason ?? NO_TRACE);
        continue;
      }
      if (session.trace.requests.length === 0) {
        unusable.add(session, EMPTY_TRACE);
        continue;
      }
      if (!session.channel.known) {
        unusable.add(session, session.channel.reason);
        continue;
      }
      const channel = session.channel.channel;
      const classification = classifyCacheBreaks({ trace: session.trace, rules: input.cacheRules, ...(session.promptChanges ? { promptChanges: session.promptChanges } : {}) });
      for (const unchecked of classification.unchecked) partial.add(session, unchecked.reason);
      for (const cacheBreak of classification.breaks) {
        const descriptor = describeBreak(cacheBreak);
        const currency = currencyOf(channel);
        const key = `${descriptor.kind}:${currency}${descriptor.discriminator === "" ? "" : `:${descriptor.discriminator}`}`;
        const group = groups.get(key) ?? { descriptor, currency, found: [] };
        group.found.push({ session, channel, cacheBreak });
        groups.set(key, group);
      }
    }

    const opportunities = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, group]) => this.opportunityOf(key, group, input, unusable, partial, priceFailures));
    return { opportunities, notAnalysed: NotAnalysedLedger.report("idle-cache-expiry", unusable, partial, priceFailures) };
  }

  private opportunityOf(
    key: string,
    group: { descriptor: GroupDescriptor; currency: Currency; found: Found[] },
    input: SavingsInput,
    unusable: NotAnalysedLedger,
    partial: NotAnalysedLedger,
    priceFailures: NotAnalysedLedger,
  ): SavingsOpportunity {
    const { descriptor, currency, found } = group;
    const parts: PricedPart[] = [];
    const failures = new Map<string, Set<SavingsSessionInput>>();
    for (const { session, channel, cacheBreak } of found) {
      const saving = input.pricer.saving(
        {
          model: cacheBreak.model,
          channel: { known: true, channel },
          at: cacheBreak.startedAt,
          tokens: cacheBreak.lostTokens,
          // The lost tokens were billed as a cache write or as plain input;
          // the dearer is the upper bound (a log with recorded writes is
          // mostly writes, one without says neither).
          billedAs: ["cacheWrite", "uncachedInput"],
          instead: "cacheRead",
          cacheWriteLifetime: pricingPolicyFor(session.providerId).defaultCacheWriteLifetime,
        },
        input.pricing,
      );
      if (saving.known) {
        parts.push(saving);
      } else {
        failures.set(saving.reason, (failures.get(saving.reason) ?? new Set()).add(session));
        priceFailures.add(session, saving.reason);
      }
    }
    const window: SavingsAmount = parts.length > 0 ? sumAmount(currency, parts, "upper-bound") : unknownAmount([...failures.keys()].sort()[0]!);

    const sessions = [...new Set(found.map((entry) => entry.session))];
    const lostTokens = found.reduce((total, entry) => total + entry.cacheBreak.lostTokens, 0);
    const extra = new Map(partial.sessionsByReason());
    for (const [reason, sessionsOfReason] of failures) extra.set(reason, new Set([...(extra.get(reason) ?? []), ...sessionsOfReason]));
    const inferred = found.some(({ cacheBreak }) =>
      cacheBreak.class === "idle-expiry"
        ? cacheBreak.caveats.includes("lifetime-assumed")
        : cacheBreak.class === "unexplained"
          ? !cacheBreak.cause.recorded
          : false,
    );
    return {
      key,
      kind: descriptor.kind,
      subject: descriptor.subject,
      sessions: sessions.map((entry) => ({ providerId: entry.providerId, sessionId: entry.session.id })),
      evidence: {
        sessions: sessions.length,
        requests: sessions.reduce((total, entry) => total + (entry.trace?.requests.length ?? 0), 0),
        tokens: { known: true, value: lostTokens },
        occurrences: found.length,
      },
      perWeek: perWeek(window, input.window),
      perWindow: window,
      coverage: unusable.coverage(input.sessions.length, extra),
      actionParams: this.actionParams(descriptor, found, lostTokens, input),
      inferred,
    };
  }

  private actionParams(descriptor: GroupDescriptor, found: Found[], lostTokens: number, input: SavingsInput): SavingsActionParams {
    switch (descriptor.kind) {
      case "idle-cache-expiry": {
        const minutes = Number(descriptor.discriminator);
        // The longer lifetime is worth naming only where the log doesn't show it in use.
        const extended = found.flatMap(({ cacheBreak }) => {
          if (cacheBreak.class !== "idle-expiry" || cacheBreak.lifetime.basis !== "vendor-default") return [];
          const rules = input.cacheRules(cacheBreak.model);
          return rules.known && rules.extendedLifetimeMinutes !== undefined ? [rules.extendedLifetimeMinutes] : [];
        });
        return { breaks: found.length, minutes, tokens: lostTokens, ...(extended.length > 0 ? { extendedMinutes: Math.max(...extended) } : {}) };
      }
      case "model-switch":
        return { times: found.length, tokens: Math.round(lostTokens / found.length) };
      case "unexplained-cache-break":
        return { breaks: found.length, tokens: lostTokens };
    }
  }
}
