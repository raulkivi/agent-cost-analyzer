// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { VendorProfile } from "@agent-cost-analyzer/domain";
import type { ProviderSource } from "../services/insights/insights-service.js";
import type { RowAttributor } from "../services/insights/insights-dataset-builder.js";
import { CostPricer } from "../services/pricing/cost-pricer.js";
import type { PriceBook } from "../services/pricing/price-book.js";
import { CandidatePriceModelMapper } from "../services/pricing/price-model-mapper.js";
import type { TurnPricing } from "../services/pricing/turn-cost-figures.js";
import { cacheRulesFromProfiles } from "../services/savings/cache-rules.js";
import { ProfileCheaperModels } from "../services/savings/cheaper-model-candidates.js";
import { CounterfactualPricer } from "../services/savings/counterfactual-pricer.js";
import { CacheBreakDetector } from "../services/savings/detectors/cache-break-detector.js";
import { CheaperModelDetector, type ReplayComparer } from "../services/savings/detectors/cheaper-model-detector.js";
import { FailedCallsDetector } from "../services/savings/detectors/failed-calls-detector.js";
import { UnusedToolsDetector } from "../services/savings/detectors/unused-tools-detector.js";
import { replayPriceVersions } from "../services/savings/replay-price-versions.js";
import { SavingsService } from "../services/savings/savings-service.js";

// Phase 16 SR10 (docs/plans/savings-report.md §5.2): one wiring of the
// savings report for every product (the standalone app and its MCP server,
// the extension and its MCP server), as create-session-replay.ts. Each
// product passes its own registry (the extension's is Copilot-only, D10)
// and the price book, attribution, turn pricer and session replay the rest
// of it already uses, so a saving is priced as the Dashboard prices a turn.
export interface SavingsReportOptions {
  providers: ProviderSource;
  profiles: readonly VendorProfile[];
  priceBook: PriceBook;
  pricer: TurnPricing;
  attribution: { snapshot(): RowAttributor };
  // SessionReplayService (createSessionReplay).
  replay: ReplayComparer;
  now?: () => Date;
}

export function createSavingsReport(options: SavingsReportOptions): SavingsService {
  const { priceBook, profiles, now } = options;
  return new SavingsService({
    providers: options.providers,
    // Open/closed: a new opportunity is one more line here.
    detectors: [
      { kind: "unused-tools", detector: new UnusedToolsDetector() },
      { kind: "idle-cache-expiry", detector: new CacheBreakDetector() },
      { kind: "failed-tool-calls", detector: new FailedCallsDetector() },
      {
        kind: "cheaper-model",
        simulated: true,
        detector: new CheaperModelDetector({ comparer: options.replay, candidates: new ProfileCheaperModels(profiles), priceVersions: replayPriceVersions(priceBook) }),
      },
    ],
    counterfactual: {
      snapshot: () => {
        const book = priceBook.snapshot();
        return new CounterfactualPricer(new CostPricer({ prices: book, models: new CandidatePriceModelMapper(book), ...(now ? { now } : {}) }));
      },
    },
    pricer: options.pricer,
    attribution: options.attribution,
    cacheRules: cacheRulesFromProfiles(profiles),
    ...(now ? { now } : {}),
  });
}
