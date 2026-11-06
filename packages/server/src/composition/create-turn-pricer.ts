import type { PricingMode } from "@agent-cost-analyzer/domain";
import { CostPricer } from "../services/pricing/cost-pricer.js";
import type { PriceBook } from "../services/pricing/price-book.js";
import { CandidatePriceModelMapper } from "../services/pricing/price-model-mapper.js";
import { TurnCostFigureBuilder, type TurnPricer, type TurnPricing } from "../services/pricing/turn-cost-figures.js";

// Phase 15 step 15.6: one wiring of the priced cost basis for every product
// that has a price book: CostPricer over the book and a model-id mapper over
// the ids the book prices, inside the builder that adds the billed and
// reported figures. Each snapshot reads the book (and so the projects file)
// once. "As of use" (plan §6.2) unless a view asks for "today" (step 15.7);
// `now` is only for tests of the "today" mode.
export function createTurnPricer(priceBook: PriceBook, now?: () => Date): TurnPricing {
  return {
    snapshot(mode?: PricingMode): TurnPricer {
      const book = priceBook.snapshot();
      return new TurnCostFigureBuilder(new CostPricer({ prices: book, models: new CandidatePriceModelMapper(book), ...(now ? { now } : {}) }), mode);
    },
  };
}
