import { z } from "zod";

// Phase 15 step 15.6 (docs/plans/cost-by-repository-and-project.md §5): a
// cost figure says how it was obtained (its basis) and in which unit, and is
// never 0 when unknown (architecture.md constraint 6).
//
// - billed:   what the vendor's billing recorded (Copilot copilotUsageNanoAiu → AI Credits)
// - reported: what the agent computed and logged itself (pi Usage.cost, USD)
// - priced:   tokens × the price version in force on the turn's channel
//
// Amounts stay in their native unit. The only conversion is GitHub's
// documented 1 AI Credit = $0.01, and every converted figure says so.

export const USD_PER_AI_CREDIT = 0.01;
export const AI_CREDIT_CONVERSION_NOTE = "1 AI Credit = $0.01 (GitHub's documented rate); no other exchange rate is used.";

export const currencySchema = z.enum(["AI_CREDITS", "USD"]);
export const costBasisSchema = z.enum(["billed", "reported", "priced"]);
// A view's basis (D3): the per-turn preferred basis, or one basis throughout.
export const costBasisChoiceSchema = z.enum(["preferred", "billed", "reported", "priced"]);
// §6.2: the price in force when the turn ran, or every turn at today's price.
export const pricingModeSchema = z.enum(["as-of-use", "today"]);

const knownCostFigureSchema = z.object({
  known: z.literal(true),
  amount: z.number().nonnegative(),
  currency: currencySchema,
  basis: costBasisSchema,
  // priced only: the price versions the amount used.
  priceVersionIds: z.array(z.string().min(1)).min(1).optional(),
  // A token count behind it was a local-tokenizer estimate.
  estimated: z.boolean().optional(),
  // priced only: tokens a flat-fee plan may have covered (Claude Code), so
  // the figure is what the same use would cost on the API (§5, D4).
  apiEquivalent: z.boolean().optional(),
  // Assumptions the figure rests on, e.g. "priced at the session start".
  notes: z.array(z.string().min(1)).optional(),
});

const unknownCostFigureSchema = z.object({ known: z.literal(false), reason: z.string().min(1) });

export const costFigureSchema = z
  .discriminatedUnion("known", [knownCostFigureSchema, unknownCostFigureSchema])
  .superRefine((figure, ctx) => {
    if (figure.known && figure.basis !== "priced" && (figure.priceVersionIds !== undefined || figure.apiEquivalent !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["priceVersionIds"], message: "price versions and apiEquivalent belong to priced figures only" });
    }
  });

export const turnCostFiguresSchema = z.object({
  billed: costFigureSchema,
  reported: costFigureSchema,
  priced: costFigureSchema,
});

export type Currency = z.infer<typeof currencySchema>;
export type CostBasis = z.infer<typeof costBasisSchema>;
export type CostBasisChoice = z.infer<typeof costBasisChoiceSchema>;
export type PricingMode = z.infer<typeof pricingModeSchema>;
export type CostFigure = z.infer<typeof costFigureSchema>;
export type KnownCostFigure = Extract<CostFigure, { known: true }>;
export type TurnCostFigures = z.infer<typeof turnCostFiguresSchema>;

const BASIS_ORDER: readonly CostBasis[] = ["billed", "reported", "priced"];
const CURRENCY_ORDER: readonly Currency[] = ["AI_CREDITS", "USD"];

export function unknownCost(reason: string): CostFigure {
  return { known: false, reason };
}

// D3: billed if known, else reported, else priced.
export function preferredCostFigure(figures: TurnCostFigures): CostFigure {
  for (const basis of BASIS_ORDER) {
    if (figures[basis].known) return figures[basis];
  }
  const reasons = BASIS_ORDER.map((basis) => {
    const figure = figures[basis];
    return `${basis}: ${figure.known ? "" : figure.reason}`;
  });
  return unknownCost(`No cost is known for this turn (${reasons.join("; ")})`);
}

export function costFigureFor(figures: TurnCostFigures, choice: CostBasisChoice): CostFigure {
  return choice === "preferred" ? preferredCostFigure(figures) : figures[choice];
}

// The figure in USD at 1 AI Credit = $0.01; null when unknown.
export function toUsd(figure: CostFigure): number | null {
  if (!figure.known) return null;
  return figure.currency === "USD" ? figure.amount : figure.amount * USD_PER_AI_CREDIT;
}

export const costAmountSchema = z.object({
  currency: currencySchema,
  amount: z.number().nonnegative(),
  knownTurns: z.number().int().nonnegative(),
});

// A total over turns, MeasureTotal-style: what is known, how many turns it
// covers, per currency, never mixing currencies except in `usd`.
export const costTotalSchema = z
  .object({
    turns: z.number().int().nonnegative(),
    knownTurns: z.number().int().nonnegative(),
    // One entry per currency present, AI Credits first.
    amounts: z.array(costAmountSchema),
    // Every known amount in USD at 1 AI Credit = $0.01; null when none is known.
    usd: z.number().nonnegative().nullable(),
    estimated: z.boolean(),
    apiEquivalentTurns: z.number().int().nonnegative(),
  })
  .refine((total) => total.knownTurns <= total.turns, { message: "knownTurns cannot exceed turns", path: ["knownTurns"] });

export const costBasisTotalsSchema = z.object({
  preferred: costTotalSchema,
  billed: costTotalSchema,
  reported: costTotalSchema,
  priced: costTotalSchema,
  // Which basis each turn's preferred figure came from.
  preferredBasisTurns: z.object({
    billed: z.number().int().nonnegative(),
    reported: z.number().int().nonnegative(),
    priced: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  }),
  // Every price version a priced figure used, sorted.
  priceVersionIds: z.array(z.string()),
  conversion: z.string(),
});

export type CostAmount = z.infer<typeof costAmountSchema>;
export type CostTotal = z.infer<typeof costTotalSchema>;
export type CostBasisTotals = z.infer<typeof costBasisTotalsSchema>;

export function sumCostFigures(figures: readonly CostFigure[]): CostTotal {
  const byCurrency = new Map<Currency, CostAmount>();
  let knownTurns = 0;
  let usd: number | null = null;
  let estimated = false;
  let apiEquivalentTurns = 0;
  for (const figure of figures) {
    if (!figure.known) continue;
    knownTurns += 1;
    const entry = byCurrency.get(figure.currency) ?? { currency: figure.currency, amount: 0, knownTurns: 0 };
    entry.amount += figure.amount;
    entry.knownTurns += 1;
    byCurrency.set(figure.currency, entry);
    usd = (usd ?? 0) + toUsd(figure)!;
    estimated ||= figure.estimated === true;
    if (figure.apiEquivalent === true) apiEquivalentTurns += 1;
  }
  return {
    turns: figures.length,
    knownTurns,
    amounts: CURRENCY_ORDER.flatMap((currency) => {
      const entry = byCurrency.get(currency);
      return entry ? [entry] : [];
    }),
    usd,
    estimated,
    apiEquivalentTurns,
  };
}

export function costBasisTotals(rows: readonly TurnCostFigures[]): CostBasisTotals {
  const preferred = rows.map(preferredCostFigure);
  const preferredBasisTurns = { billed: 0, reported: 0, priced: 0, unknown: 0 };
  for (const figure of preferred) {
    preferredBasisTurns[figure.known ? figure.basis : "unknown"] += 1;
  }
  const versions = new Set(rows.flatMap((row) => (row.priced.known ? (row.priced.priceVersionIds ?? []) : [])));
  return {
    preferred: sumCostFigures(preferred),
    billed: sumCostFigures(rows.map((row) => row.billed)),
    reported: sumCostFigures(rows.map((row) => row.reported)),
    priced: sumCostFigures(rows.map((row) => row.priced)),
    preferredBasisTurns,
    priceVersionIds: [...versions].sort(),
    conversion: AI_CREDIT_CONVERSION_NOTE,
  };
}

// §5 reconciliation: for Copilot turns, what GitHub billed against what the
// price book gives for the same tokens, per model and month. A steady gap
// means the price book is wrong or out of date (step 15.10 raises it as a
// finding). Only turns with both figures in AI Credits are compared; a
// billed turn the book can't price is counted, never compared as 0.
export const costReconciliationRowSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  model: z.string(),
  turns: z.number().int().nonnegative(), // billed and priced both known
  billedAiCredits: z.number().nonnegative().nullable(),
  pricedAiCredits: z.number().nonnegative().nullable(),
  difference: z.number().nullable(), // billed − priced
  ratio: z.number().nonnegative().nullable(), // billed ÷ priced; null when priced is 0 or none compared
  billedOnlyTurns: z.number().int().nonnegative(), // billed, but no priced figure
  priceVersionIds: z.array(z.string()),
});

export type CostReconciliationRow = z.infer<typeof costReconciliationRowSchema>;

export interface ReconciliationInput {
  month: string | undefined; // YYYY-MM of the turn's time
  model: string;
  cost: TurnCostFigures;
}

const round = (value: number) => Math.round(value * 1e9) / 1e9;

export function buildCostReconciliation(turns: readonly ReconciliationInput[]): CostReconciliationRow[] {
  const groups = new Map<string, { month: string; model: string; billed: number; priced: number; turns: number; billedOnly: number; versions: Set<string> }>();
  for (const turn of turns) {
    const { billed, priced } = turn.cost;
    if (turn.month === undefined || !billed.known || billed.currency !== "AI_CREDITS") continue;
    const key = JSON.stringify([turn.month, turn.model]);
    const group = groups.get(key) ?? { month: turn.month, model: turn.model, billed: 0, priced: 0, turns: 0, billedOnly: 0, versions: new Set() };
    if (priced.known && priced.currency === "AI_CREDITS") {
      group.turns += 1;
      group.billed += billed.amount;
      group.priced += priced.amount;
      for (const id of priced.priceVersionIds ?? []) group.versions.add(id);
    } else {
      group.billedOnly += 1;
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.month.localeCompare(b.month) || a.model.localeCompare(b.model))
    .map((group) => {
      const compared = group.turns > 0;
      return {
        month: group.month,
        model: group.model,
        turns: group.turns,
        billedAiCredits: compared ? round(group.billed) : null,
        pricedAiCredits: compared ? round(group.priced) : null,
        difference: compared ? round(group.billed - group.priced) : null,
        ratio: compared && group.priced > 0 ? round(group.billed / group.priced) : null,
        billedOnlyTurns: group.billedOnly,
        priceVersionIds: [...group.versions].sort(),
      };
    });
}
