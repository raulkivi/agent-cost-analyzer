// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { PricingMode, SavingsNotAnalysed, SavingsOpportunityKind, SavingsReport, Session } from "@agent-cost-analyzer/domain";
import type { LogProvider } from "../../data-sources/log-providers/log-provider.js";
import { UnknownLogProviderIdError } from "../../data-sources/log-providers/registry.js";
import type { ProviderSource } from "../insights/insights-service.js";
import type { RowAttributor } from "../insights/insights-dataset-builder.js";
import type { TurnPricing } from "../pricing/turn-cost-figures.js";
import { inRange, MAX_ROLLUP_SESSION_LIMIT } from "../tool-audit/audit-query-service.js";
import type { CacheRulesLookup } from "./cache-break-classifier.js";
import type { CounterfactualPricer } from "./counterfactual-pricer.js";
import type { DetectorResult, SavingsDetector, SavingsInput, SavingsSessionInput } from "./savings-detector.js";
import { SavingsRanker } from "./savings-ranker.js";
import { SavingsSessionLoader } from "./savings-session-loader.js";
import { savingsWindowOf } from "./savings-window.js";

// Phase 16 SR10 (docs/plans/savings-report.md §5.2, §11, D3–D5, D8): the
// savings report on request. Loads the window's most recent sessions, one at
// a time and at most MAX_ROLLUP_SESSION_LIMIT across providers (each read can
// parse a large log), runs the registered detectors over them and ranks the
// result. Sessions it could not give the detectors are listed under every
// kind it ran, never dropped. Cancelled through the AbortSignal between
// sessions and between detectors: it rejects with the signal's reason (an
// AbortError), as a cancelled fetch does. Nothing is stored.

export interface SavingsFilter {
  // One provider, or every available one.
  providerId?: string;
  // Calendar dates, both inclusive (D8: 30 days to today by default).
  since?: string;
  until?: string;
  // Sessions to read, newest first; capped at MAX_ROLLUP_SESSION_LIMIT.
  limit?: number;
}

export interface SavingsOptions {
  pricing?: PricingMode;
  // D5: the cheaper-model replays, off unless asked.
  includeSimulated?: boolean;
}

// A detector as the report runs it. `kind` is the kind its Not-analysed rows
// use, so sessions the service left out are listed beside them.
export interface RegisteredDetector {
  kind: SavingsOpportunityKind;
  detector: SavingsDetector;
  // A replay (Simulated): run only with includeSimulated.
  simulated?: boolean;
}

export interface SavingsServiceDeps {
  providers: ProviderSource;
  detectors: readonly RegisteredDetector[];
  // Over the price book as it is when a report is made.
  counterfactual: { snapshot(): CounterfactualPricer };
  pricer: TurnPricing;
  attribution: { snapshot(): RowAttributor };
  cacheRules: CacheRulesLookup;
  now?: () => Date;
}

export interface SavingsQueries {
  report(filter?: SavingsFilter, options?: SavingsOptions, signal?: AbortSignal): Promise<SavingsReport>;
}

interface Candidate {
  provider: LogProvider;
  summary: Session;
}

const UNREADABLE = "The session's log could not be read.";
const overCap = (cap: number) => `Over the ${cap}-session cap: only the ${cap} most recent sessions in the window were read.`;

// Sessions left out, per provider and reason.
class LeftOut {
  private readonly counts = new Map<string, { providerId: string; reason: string; sessions: number }>();

  add(providerId: string, reason: string): void {
    const key = `${providerId}\u0000${reason}`;
    const entry = this.counts.get(key) ?? { providerId, reason, sessions: 0 };
    entry.sessions += 1;
    this.counts.set(key, entry);
  }

  under(kinds: readonly SavingsOpportunityKind[]): SavingsNotAnalysed[] {
    return kinds.flatMap((kind) => [...this.counts.values()].map((entry) => ({ kind, ...entry })));
  }
}

export class SavingsService implements SavingsQueries {
  private readonly ranker = new SavingsRanker();
  private readonly now: () => Date;

  constructor(private readonly deps: SavingsServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async report(filter: SavingsFilter = {}, options: SavingsOptions = {}, signal?: AbortSignal): Promise<SavingsReport> {
    signal?.throwIfAborted();
    const window = savingsWindowOf(filter, this.now());
    const pricing = options.pricing ?? "as-of-use";
    const providers = this.selectProviders(filter.providerId);
    const cap = Math.min(filter.limit ?? MAX_ROLLUP_SESSION_LIMIT, MAX_ROLLUP_SESSION_LIMIT);
    const leftOut = new LeftOut();

    const candidates = await this.candidates(providers, window, signal);
    candidates.slice(cap).forEach(({ provider }) => leftOut.add(provider.id, overCap(cap)));
    const sessions = await this.load(candidates.slice(0, cap), pricing, leftOut, signal);

    const registered = this.deps.detectors.filter((entry) => !entry.simulated || options.includeSimulated === true);
    const input: SavingsInput = { window, sessions, pricer: this.deps.counterfactual.snapshot(), pricing, cacheRules: this.deps.cacheRules };
    const results: DetectorResult[] = [];
    // One at a time: the cheaper-model detector replays sessions.
    for (const { detector } of registered) {
      signal?.throwIfAborted();
      results.push(await detector.detect(input));
    }
    signal?.throwIfAborted();
    const kinds = [...new Set(registered.map((entry) => entry.kind))];
    return this.ranker.rank({ window, pricing, results, leftOut: leftOut.under(kinds) });
  }

  private selectProviders(providerId: string | undefined): LogProvider[] {
    const all = this.deps.providers.listProviders();
    if (providerId === undefined) return all;
    const match = all.filter((provider) => provider.id === providerId);
    if (match.length === 0) throw new UnknownLogProviderIdError(providerId);
    return match;
  }

  // The window's sessions of every available provider, newest first.
  private async candidates(providers: readonly LogProvider[], window: { since: string; until: string }, signal?: AbortSignal): Promise<Candidate[]> {
    const found: Candidate[] = [];
    for (const provider of providers) {
      signal?.throwIfAborted();
      if (!(await provider.checkAvailability()).available) continue;
      for (const summary of await provider.listSessions()) {
        if (inRange(summary.startedAt, window.since, window.until)) found.push({ provider, summary });
      }
    }
    return found.sort((a, b) => (b.summary.startedAt ?? "").localeCompare(a.summary.startedAt ?? ""));
  }

  // Sequential on purpose (as InsightsService.load): each read can parse a large log.
  private async load(candidates: readonly Candidate[], pricing: PricingMode, leftOut: LeftOut, signal?: AbortSignal): Promise<SavingsSessionInput[]> {
    const loader = new SavingsSessionLoader({ attributor: this.deps.attribution.snapshot(), turnPricer: this.deps.pricer.snapshot(pricing) });
    const sessions: SavingsSessionInput[] = [];
    for (const { provider, summary } of candidates) {
      signal?.throwIfAborted();
      try {
        const input = await loader.load(provider, summary.id);
        if (input) sessions.push(input);
      } catch {
        leftOut.add(provider.id, UNREADABLE);
      }
    }
    signal?.throwIfAborted();
    return sessions;
  }
}
