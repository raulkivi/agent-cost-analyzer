import type { VendorProfile } from "@agent-cost-analyzer/domain";
import type { SessionCostSources } from "../services/analysis/analysis-query-service.js";
import type { PriceBook } from "../services/pricing/price-book.js";
import { CostPricer } from "../services/pricing/cost-pricer.js";
import { CandidatePriceModelMapper } from "../services/pricing/price-model-mapper.js";
import type { TurnPricing } from "../services/pricing/turn-cost-figures.js";
import { SessionReplayService } from "../services/session-replay/session-replay-service.js";
import type { ProviderLookup } from "../services/tool-audit/audit-query-service.js";

// Phase 14 step 14.5: one wiring of SessionReplayService for every product
// (the standalone app and its MCP server, the extension and its MCP
// server). A replay is priced by a CostPricer over the price book as it is
// at that replay (D2); the session's measured figures and channel come from
// the same attribution and turn pricer as get_session_cost (step 15.6).
export interface SessionReplayOptions {
  providers: ProviderLookup;
  profiles: readonly VendorProfile[];
  priceBook: PriceBook;
  pricer: TurnPricing;
  attribution?: SessionCostSources["attribution"];
}

export function createSessionReplay(options: SessionReplayOptions): SessionReplayService {
  return new SessionReplayService({
    providers: options.providers,
    profiles: options.profiles,
    prices: {
      snapshot: () => {
        const book = options.priceBook.snapshot();
        return new CostPricer({ prices: book, models: new CandidatePriceModelMapper(book) });
      },
    },
    costs: { pricer: options.pricer, ...(options.attribution ? { attribution: options.attribution } : {}) },
  });
}
