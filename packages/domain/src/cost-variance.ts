import { z } from "zod";
import { costCompareGroupBySchema, costCurrencyChoiceSchema } from "./cost-analysis.js";
import { currencySchema } from "./cost-figure.js";
import { insightProviderStatusSchema } from "./insights.js";
import { isoCalendarDateSchema } from "./price-book.js";
import { priceChangeMarkerSchema } from "./price-change.js";

// Phase 15 step 15.10 (docs/plans/cost-by-repository-and-project.md §8.4,
// D12, §10.1.1 explain_cost_change): why a repository's or project's cost
// changed between two periods. On the priced basis, as of use, per currency:
//
//   usage (volume) = Σ_type (all tokens B − all tokens A) × A's average price
//   price          = Σ_cells tokens B × (unit price B − unit price A)
//   mix            = Σ_cells (tokens B − tokens A) × unit price A − usage
//
// so usage + price + mix = cost B − cost A exactly (to float rounding). A
// cell is one model and token type; a unit price is cost ÷ tokens, per 1M
// tokens, in the currency's unit. A cell with no tokens in one period takes
// the other period's unit price (a new or dropped model is all usage/mix).

export const varianceTokenTypeSchema = z.enum(["uncachedInput", "cacheRead", "cacheWrite", "output"]);
export type VarianceTokenType = z.infer<typeof varianceTokenTypeSchema>;
export const varianceTokenTypes: readonly VarianceTokenType[] = varianceTokenTypeSchema.options;

// Float sums are compared to this tolerance, relative to the amounts.
export const VARIANCE_TOLERANCE = 1e-6;

const tokens = z.number().nonnegative();
const money = z.number().nonnegative();

export const varianceCellSchema = z.object({
  tokenType: varianceTokenTypeSchema,
  tokensA: tokens,
  tokensB: tokens,
  unitPriceA: z.number().nonnegative().nullable(), // per 1M tokens; null: no tokens in either period
  unitPriceB: z.number().nonnegative().nullable(),
  costA: money,
  costB: money,
  usage: z.number(), // (tokens B − tokens A) × unit price A
  price: z.number(), // tokens B × (unit price B − unit price A)
});

export const varianceModelSchema = z.object({
  model: z.string(),
  vendorId: z.string().nullable(),
  costA: money,
  costB: money,
  change: z.number(),
  usage: z.number(), // this model's usage effect (volume and mix together)
  price: z.number(),
  priceVersionIdsA: z.array(z.string()),
  priceVersionIdsB: z.array(z.string()),
  byTokenType: z.array(varianceCellSchema),
});

export const varianceTokenTypeTotalSchema = z.object({
  tokenType: varianceTokenTypeSchema,
  tokensA: tokens,
  tokensB: tokens,
  averagePriceA: z.number().nonnegative().nullable(), // per 1M tokens over every model
  usage: z.number(), // volume effect
  mix: z.number(),
  price: z.number(),
});

const near = (a: number, b: number, scale: number) => Math.abs(a - b) <= VARIANCE_TOLERANCE * Math.max(1, scale);

export const varianceCurrencySchema = z
  .object({
    currency: currencySchema,
    costA: money,
    costB: money,
    change: z.number(),
    usage: z.number(),
    price: z.number(),
    mix: z.number(),
    turnsA: z.number().int().nonnegative(),
    turnsB: z.number().int().nonnegative(),
    byTokenType: z.array(varianceTokenTypeTotalSchema),
    models: z.array(varianceModelSchema), // by |change|, largest first
  })
  .superRefine((row, ctx) => {
    const scale = Math.max(row.costA, row.costB);
    if (!near(row.usage + row.price + row.mix, row.change, scale) || !near(row.costB - row.costA, row.change, scale)) {
      ctx.addIssue({ code: "custom", path: ["change"], message: "usage, price and mix effects must add up to the change" });
    }
    row.models.forEach((model, index) => {
      if (!near(model.usage + model.price, model.change, Math.max(model.costA, model.costB))) {
        ctx.addIssue({ code: "custom", path: ["models", index], message: "a model's usage and price effects must add up to its change" });
      }
    });
  });

export const variancePeriodSchema = z.object({
  label: z.string(), // "2026-10" or "2026-10-01 – 2026-10-15"
  since: isoCalendarDateSchema,
  until: isoCalendarDateSchema,
});

// Turns the effects can't explain (no priced figure), counted with why.
const notExplainedSchema = z.object({ turns: z.number().int().nonnegative(), reasons: z.array(z.string()).optional() });

export const costVarianceSchema = z.object({
  generatedAt: z.string(),
  groupBy: costCompareGroupBySchema,
  id: z.string(),
  label: z.string(),
  periodA: variancePeriodSchema,
  periodB: variancePeriodSchema,
  basis: z.literal("priced"),
  pricing: z.literal("as-of-use"),
  currency: costCurrencyChoiceSchema,
  conversion: z.string(),
  providers: z.array(insightProviderStatusSchema),
  currencies: z.array(varianceCurrencySchema), // AI Credits first
  notExplained: z.object({ periodA: notExplainedSchema, periodB: notExplainedSchema }),
  // Documented changes from period A's start to period B's end, for the models compared.
  priceChanges: z.array(priceChangeMarkerSchema),
});

export type VarianceCell = z.infer<typeof varianceCellSchema>;
export type VarianceModel = z.infer<typeof varianceModelSchema>;
export type VarianceTokenTypeTotal = z.infer<typeof varianceTokenTypeTotalSchema>;
export type VarianceCurrency = z.infer<typeof varianceCurrencySchema>;
export type VariancePeriod = z.infer<typeof variancePeriodSchema>;
export type CostVariance = z.infer<typeof costVarianceSchema>;
