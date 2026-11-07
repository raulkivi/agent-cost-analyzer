import { z } from "zod";
import { isoCalendarDateSchema } from "./price-book.js";
import { replayAssumptionSchema } from "./session-replay.js";

// Phase 15 step 15.12 (docs/plans/cost-by-repository-and-project.md §8.6,
// D16–D18): an estimate of a project's (or repository's) cost for planned
// work, from its history at today's prices. Always a p50–p90 range labelled
// "estimate", never a single number (D16: the median and 90th-percentile
// cost per active day, or per session, × the planned units). With fewer than
// MIN_ESTIMATE_UNITS known units there is no range, only the reason (D18).
// Phase 14 step 14.5 (analyze-session-replay.md §9, D7, closing D17 here):
// on another model, every session in the window is replayed on it and the
// unit costs are the simulated ones, labelled so, priced as each session was
// used (the replay's D2 channel at its own dates, so "as-of-use").

export const MIN_ESTIMATE_UNITS = 5;
export const ESTIMATE_HISTORY_WEEKS = [4, 12] as const;

export const estimateUnitSchema = z.enum(["activeDays", "sessions"]);
export type EstimateUnit = z.infer<typeof estimateUnitSchema>;

const usd = z.number().nonnegative();
const count = z.number().int().nonnegative();

// How an estimate on another model was made and what it covers.
export const estimateSimulationSchema = z
  .object({
    label: z.literal("simulated"),
    model: z.string().min(1),
    vendorId: z.string().min(1),
    method: z.string().min(1),
    // The target's sessions in the window, and those replayed.
    sessions: count,
    replayedSessions: count,
    // Their turns, and those with a known simulated cost; the rest by reason.
    turns: count,
    replayedTurns: count,
    notReplayed: z.array(z.object({ reason: z.string().min(1), turns: count }).strict()),
    // Replayed sessions whose own-model self-check ran, and passed.
    selfCheck: z.object({ checked: count, passed: count }).strict(),
    assumptions: z.array(replayAssumptionSchema),
  })
  .strict()
  .refine((simulation) => simulation.replayedSessions <= simulation.sessions && simulation.replayedTurns <= simulation.turns, {
    message: "replayed sessions and turns cannot exceed those seen",
    path: ["replayedTurns"],
  })
  .refine((simulation) => simulation.selfCheck.passed <= simulation.selfCheck.checked && simulation.selfCheck.checked <= simulation.replayedSessions, {
    message: "self-checks passed cannot exceed those run, nor those the replayed sessions",
    path: ["selfCheck"],
  });

export const costEstimateSchema = z
  .object({
    label: z.literal("estimate"),
    generatedAt: z.string(),
    target: z.object({ groupBy: z.enum(["project", "repository"]), id: z.string(), name: z.string() }),
    pricing: z.enum(["today", "as-of-use"]),
    currency: z.literal("USD"),
    conversion: z.string(),
    window: z.object({ weeks: z.union([z.literal(4), z.literal(12)]), since: isoCalendarDateSchema, until: isoCalendarDateSchema }),
    unit: estimateUnitSchema,
    planned: z.number().int().positive(),
    // The history: units seen, those with every turn priced, turns, and their cost.
    history: z.object({ units: count, knownUnits: count, turns: count, totalUsd: usd }),
    runRate: z.object({ perActiveDayUsd: usd.nullable(), perWeekUsd: usd }),
    unitCost: z.object({ p50: usd, p90: usd }).nullable(),
    range: z.object({ p50: usd, p90: usd }).nullable(),
    refusal: z.string().min(1).optional(),
    simulation: estimateSimulationSchema.optional(),
  })
  .superRefine((estimate, ctx) => {
    if ((estimate.range === null) !== (estimate.refusal !== undefined) || (estimate.range === null) !== (estimate.unitCost === null)) {
      ctx.addIssue({ code: "custom", path: ["refusal"], message: "an estimate has a range and unit costs, or neither and the reason why" });
    }
    if ((estimate.simulation !== undefined) !== (estimate.pricing === "as-of-use")) {
      ctx.addIssue({ code: "custom", path: ["pricing"], message: 'an estimate is at today\'s prices, or simulated on another model and "as-of-use"' });
    }
    if (estimate.range && estimate.range.p50 > estimate.range.p90) {
      ctx.addIssue({ code: "custom", path: ["range"], message: "p50 can't be above p90" });
    }
  });

export type CostEstimate = z.infer<typeof costEstimateSchema>;

// The q-quantile (0..1) of a non-empty sample, by linear interpolation
// between order statistics (R's type 7).
export function percentile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}
