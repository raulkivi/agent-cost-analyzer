// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";
import { costBasisSchema, currencySchema } from "./cost-figure.js";
import { cacheOutcomeSchema } from "./simulation.js";
import { tokenCountSchema } from "./token-count.js";
import { confidenceSchema, harnessSchema } from "./vendor-profile.js";

// Phase 14 step 14.1 (docs/plans/analyze-session-replay.md §3, §8): a real
// session replayed on another model. The measured figures stay beside the
// simulated ones; the whole answer is labelled simulated; an unknown is null
// or a reason, never 0 (constraint 6).

const count = z.number().int().nonnegative();
const tokens = count;

// The cap on models per comparison (threat-model.md §4, step 14.0).
export const MAX_COMPARED_MODELS = 10;
// Phase 13's calibration tolerance (D12 there): cache read within 5%.
export const REPLAY_READ_TOLERANCE_PERCENT = 5;

const knownCost = z.object({ known: z.literal(true), value: z.number().nonnegative(), currency: currencySchema }).strict();
const unknownCost = z.object({ known: z.literal(false), reason: z.string().min(1) }).strict();

// What the session really cost: its preferred figure (billed, reported or
// priced, Phase 15 D3) with that basis.
export const measuredCostSchema = z.discriminatedUnion("known", [knownCost.extend({ basis: costBasisSchema }).strict(), unknownCost]);
// What the replay says it would have cost.
export const simulatedCostSchema = z.discriminatedUnion("known", [knownCost, unknownCost]);

// D2: priced on the session's own channel (Copilot's price table, or the
// vendor's API price as of the session's date), or on the one asked for.
// The channel is null, with the reason, when none is known (the session's
// own is unknown, or the vendor lists no API channel): then nothing
// simulated is priced, and no channel is made up (constraint 6).
export const replayPriceChannelSchema = z.enum(["copilot", "api"]);
export const replayPricingSchema = z
  .object({
    channel: replayPriceChannelSchema.nullable(),
    reason: z.string().min(1).optional(),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    requested: z.enum(["session-channel", "copilot", "api"]),
  })
  .strict()
  .refine((pricing) => (pricing.channel === null) === (pricing.reason !== undefined), {
    message: "a reason is given exactly when no price channel is known",
    path: ["reason"],
  });

export const replayTurnSchema = z
  .object({
    turnIndex: count,
    measured: z.object({ cacheRead: tokens.nullable(), cost: measuredCostSchema }).strict(),
    simulated: z
      .object({ cacheRead: tokens, cacheWrite: tokens, outcome: cacheOutcomeSchema, cost: simulatedCostSchema })
      .strict()
      .nullable(),
    notReplayedReason: z.string().min(1).optional(),
  })
  .strict()
  .refine((turn) => (turn.simulated === null) === (turn.notReplayedReason !== undefined), {
    message: "a turn is either replayed (simulated figures) or not (a reason), never both",
    path: ["notReplayedReason"],
  });

// A total over turns: null exactly when no turn's figure is known.
export const replayTotalSchema = z
  .object({ value: z.number().nonnegative().nullable(), knownTurns: count, turns: count })
  .strict()
  .refine((total) => total.knownTurns <= total.turns, { message: "knownTurns cannot exceed turns", path: ["knownTurns"] })
  .refine((total) => (total.value === null) === (total.knownTurns === 0), { message: "value is null exactly when no turn is known", path: ["value"] });

// Step 10.19 (D11): subagent runs sit outside the replay (it covers the main
// agent). Unknown AI Credits keep their reason.
export const replaySubagentRunsSchema = z.object({ runs: count, costAiCredits: tokenCountSchema }).strict();

export const replayCoverageSchema = z
  .object({
    turns: count,
    replayedTurns: count,
    requests: count,
    replayedRequests: count,
    notReplayed: z.array(z.object({ reason: z.string().min(1), turns: count }).strict()),
    // Absent when no run was read.
    subagentRuns: replaySubagentRunsSchema.optional(),
  })
  .strict()
  .refine((coverage) => coverage.replayedTurns <= coverage.turns, { message: "replayedTurns cannot exceed turns", path: ["replayedTurns"] })
  .refine((coverage) => coverage.replayedRequests <= coverage.requests, { message: "replayedRequests cannot exceed requests", path: ["replayedRequests"] });

// G4: the same script on the session's own model against the log.
export const replaySelfCheckSchema = z
  .object({
    model: z.string().min(1),
    // Every model the replay ran, in the order the session used them (one more after a switch); `model` is the first.
    models: z.array(z.string().min(1)).min(1),
    requests: count, matching: count, readTolerancePercent: z.number().positive(), passed: z.boolean() })
  .strict()
  .refine((check) => check.models[0] === check.model, { message: "model is the first of models", path: ["model"] })
  .refine((check) => check.matching <= check.requests, { message: "matching cannot exceed requests", path: ["matching"] })
  .refine((check) => check.passed === (check.matching === check.requests), { message: "passed means every request matched", path: ["passed"] });

// The plan's §6 assumptions (A1–A5), worded for a person.
export const replayAssumptionSchema = z
  .object({ id: z.string().regex(/^A\d+$/), text: z.string().min(1), confidence: confidenceSchema })
  .strict();

export const sessionReplaySchema = z
  .object({
    simulated: z.literal(true),
    sessionId: z.string().min(1),
    providerId: z.string().min(1),
    harness: harnessSchema,
    // The models the session really used (several after a model switch).
    measuredModels: z.array(z.string().min(1)).min(1),
    model: z.string().min(1),
    vendorId: z.string().min(1),
    pricing: replayPricingSchema,
    currency: currencySchema,
    turns: z.array(replayTurnSchema),
    totals: z
      .object({ measured: replayTotalSchema, simulated: replayTotalSchema, difference: z.number().nullable() })
      .strict()
      .refine((totals) => (totals.difference === null) === (totals.measured.value === null || totals.simulated.value === null), {
        message: "the difference is null exactly when either total is unknown",
        path: ["difference"],
      }),
    coverage: replayCoverageSchema,
    // null when the session's own model has no vendor profile to replay on.
    selfCheck: replaySelfCheckSchema.nullable(),
    assumptions: z.array(replayAssumptionSchema),
  })
  .strict();

export const sessionReplayComparisonSchema = z
  .object({
    simulated: z.literal(true),
    sessionId: z.string().min(1),
    providerId: z.string().min(1),
    currency: currencySchema,
    // The models the session really used, in order; several after a model switch.
    measuredModels: z.array(z.string().min(1)).min(1),
    measured: replayTotalSchema,
    entries: z
      .array(
        z
          .object({
            model: z.string().min(1),
            vendorId: z.string().min(1),
            total: replayTotalSchema,
            replayedTurns: count,
            // The session used only this model.
            isMeasuredModel: z.boolean(),
            // The session switched models; this is the first model it used, replayed whole, and `measuredModels` names them all.
            isMixedSessionModel: z.boolean(),
          })
          .strict()
          .refine((entry) => !(entry.isMeasuredModel && entry.isMixedSessionModel), {
            message: "an entry is the measured model or a mixed session's, not both",
            path: ["isMixedSessionModel"],
          }),
      )
      .min(1)
      .max(MAX_COMPARED_MODELS),
    // The runs every entry leaves out, as in a single replay's coverage; absent when no run was read.
    subagentRuns: replaySubagentRunsSchema.optional(),
  })
  .strict();

export type MeasuredCost = z.infer<typeof measuredCostSchema>;
export type SimulatedCost = z.infer<typeof simulatedCostSchema>;
export type ReplayPriceChannel = z.infer<typeof replayPriceChannelSchema>;
export type ReplayPricing = z.infer<typeof replayPricingSchema>;
export type ReplayTurn = z.infer<typeof replayTurnSchema>;
export type ReplayTotal = z.infer<typeof replayTotalSchema>;
export type ReplaySubagentRuns = z.infer<typeof replaySubagentRunsSchema>;
export type ReplayCoverage = z.infer<typeof replayCoverageSchema>;
export type ReplaySelfCheck = z.infer<typeof replaySelfCheckSchema>;
export type ReplayAssumption = z.infer<typeof replayAssumptionSchema>;
export type SessionReplay = z.infer<typeof sessionReplaySchema>;
export type SessionReplayComparison = z.infer<typeof sessionReplayComparisonSchema>;
