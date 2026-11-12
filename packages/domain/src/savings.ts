// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";
import { currencySchema, pricingModeSchema } from "./cost-figure.js";
import { tokenCountSchema } from "./token-count.js";

// Phase 16 step SR1 (docs/plans/savings-report.md §5.2, §7): a ranked list of
// changes that would cost less, each with an amount that is a range, an upper
// bound or Simulated, never a bare number, and an unknown amount carries its
// reason, never 0 (architecture.md constraint 6). Amounts are a quantity, so
// they live here and not on InsightFinding (D2).

const count = z.number().int().nonnegative();

// Names from logs (tool, MCP server, program) are capped before they reach a
// report (threat-model: log-derived names).
export const MAX_SAVINGS_NAME_LENGTH = 80;

export const savingsOpportunityKindSchema = z.enum([
  "unused-tools",
  "idle-cache-expiry",
  "unexplained-cache-break",
  "model-switch",
  "failed-tool-calls",
  "cheaper-model",
]);

// priced: a counterfactual priced from the price book (it cannot be billed);
// simulated: a Phase 14 replay on another model (assumption A1).
export const savingsBasisSchema = z.enum(["priced", "simulated"]);
export const savingsLabelSchema = z.enum(["range", "upper-bound", "simulated"]);

const knownSavingsAmountSchema = z.object({
  known: z.literal(true),
  currency: currencySchema,
  low: z.number().nonnegative(),
  high: z.number().nonnegative(),
  basis: savingsBasisSchema,
  label: savingsLabelSchema,
  priceVersionIds: z.array(z.string().min(1)).min(1),
});

const unknownSavingsAmountSchema = z.object({ known: z.literal(false), reason: z.string().min(1) });

export const savingsAmountSchema = z.discriminatedUnion("known", [knownSavingsAmountSchema, unknownSavingsAmountSchema]).superRefine((amount, ctx) => {
  if (!amount.known) return;
  if (amount.low > amount.high) {
    ctx.addIssue({ code: "custom", path: ["low"], message: "low cannot exceed high" });
  }
  if ((amount.basis === "simulated") !== (amount.label === "simulated")) {
    ctx.addIssue({ code: "custom", path: ["label"], message: "a simulated amount carries the simulated label, and only a simulated amount does" });
  }
  if (amount.label === "upper-bound" && amount.low !== 0) {
    ctx.addIssue({ code: "custom", path: ["low"], message: "an upper bound claims no lower bound, so low is 0" });
  }
});

export const savingsSessionRefSchema = z.object({ providerId: z.string().min(1), sessionId: z.string().min(1) });

// Counts behind the saving. Null is unknown, never 0.
export const savingsEvidenceSchema = z.object({
  sessions: count,
  requests: count.nullable(),
  // Per-tool or lost tokens; a local-tokenizer count says `estimated`.
  tokens: tokenCountSchema.nullable(),
  // Breaks, failed calls: whatever the opportunity counts.
  occurrences: count.nullable(),
});

export const savingsCoverageSchema = z
  .object({
    sessionsInWindow: count,
    sessionsAnalysed: count,
    notAnalysed: z.array(z.object({ reason: z.string().min(1), sessions: count })),
  })
  .refine((coverage) => coverage.sessionsAnalysed <= coverage.sessionsInWindow, { message: "sessionsAnalysed cannot exceed sessionsInWindow", path: ["sessionsAnalysed"] });

// Action text is a fixed template; its parameters are numbers, model ids and
// capped names only (savings-actions.ts).
export const savingsActionParamsSchema = z.record(z.string().min(1), z.union([z.number(), z.string().max(MAX_SAVINGS_NAME_LENGTH)]));

const savingsCount = count;

// A cheaper-model replay's own checks, carried with the saving (§7: it always
// shows assumption A1 and the self-check). Counts only; the assumption texts
// are the replay's fixed sentences.
export const savingsSimulationSchema = z
  .object({
    model: z.string().min(1).max(MAX_SAVINGS_NAME_LENGTH),
    selfCheck: z
      .object({ requests: savingsCount, matching: savingsCount, passed: z.boolean() })
      .refine((check) => check.matching <= check.requests, { message: "matching cannot exceed requests", path: ["matching"] }),
    coverage: z
      .object({ turns: savingsCount, replayedTurns: savingsCount, requests: savingsCount, replayedRequests: savingsCount })
      .refine((coverage) => coverage.replayedTurns <= coverage.turns && coverage.replayedRequests <= coverage.requests, { message: "a replay cannot cover more than there is", path: ["replayedTurns"] }),
    assumptions: z.array(z.object({ id: z.string().min(1), text: z.string().min(1) })),
  });

export const savingsOpportunitySchema = z
  .object({
    key: z.string().min(1).max(MAX_SAVINGS_NAME_LENGTH * 2),
    kind: savingsOpportunityKindSchema,
    subject: z.string().min(1).max(MAX_SAVINGS_NAME_LENGTH),
    sessions: z.array(savingsSessionRefSchema),
    evidence: savingsEvidenceSchema,
    // Total over the window ÷ weeks in the window (D8), per currency.
    perWeek: savingsAmountSchema,
    perWindow: savingsAmountSchema,
    coverage: savingsCoverageSchema,
    actionParams: savingsActionParamsSchema,
    // The grouping or cause is a guess (e.g. an MCP server read from a `mcp_` name).
    inferred: z.boolean(),
    // cheaper-model only.
    simulation: savingsSimulationSchema.optional(),
  })
  .superRefine((opportunity, ctx) => {
    if (opportunity.simulation !== undefined && opportunity.kind !== "cheaper-model") {
      ctx.addIssue({ code: "custom", path: ["simulation"], message: "only a cheaper-model opportunity carries a simulation" });
    }
    // D3: a Simulated saving is never ranked with the priced ones, so the
    // kind and the basis must agree.
    for (const field of ["perWeek", "perWindow"] as const) {
      const amount = opportunity[field];
      if (!amount.known) continue;
      if ((opportunity.kind === "cheaper-model") !== (amount.basis === "simulated")) {
        ctx.addIssue({ code: "custom", path: [field], message: "only a cheaper-model opportunity is simulated, and it always is" });
      }
    }
  });

export const savingsWindowSchema = z.object({
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.number().int().positive(),
});

export const savingsNotAnalysedSchema = z.object({
  kind: savingsOpportunityKindSchema,
  providerId: z.string().min(1),
  reason: z.string().min(1),
  sessions: count,
});

export const savingsReportSchema = z
  .object({
    window: savingsWindowSchema,
    pricing: pricingModeSchema,
    // Ranked by the high end (D3), priced opportunities only. No grand total (D4).
    opportunities: z.array(savingsOpportunitySchema),
    // Their own unranked section.
    simulated: z.array(savingsOpportunitySchema),
    notAnalysed: z.array(savingsNotAnalysedSchema),
  })
  .superRefine((report, ctx) => {
    if (report.opportunities.some((opportunity) => opportunity.kind === "cheaper-model")) {
      ctx.addIssue({ code: "custom", path: ["opportunities"], message: "a simulated opportunity is never in the ranked list" });
    }
    if (report.simulated.some((opportunity) => opportunity.kind !== "cheaper-model")) {
      ctx.addIssue({ code: "custom", path: ["simulated"], message: "the simulated section holds simulated opportunities only" });
    }
  });

export type SavingsOpportunityKind = z.infer<typeof savingsOpportunityKindSchema>;
export type SavingsBasis = z.infer<typeof savingsBasisSchema>;
export type SavingsLabel = z.infer<typeof savingsLabelSchema>;
export type SavingsSimulation = z.infer<typeof savingsSimulationSchema>;
export type SavingsAmount = z.infer<typeof savingsAmountSchema>;
export type SavingsEvidence = z.infer<typeof savingsEvidenceSchema>;
export type SavingsCoverage = z.infer<typeof savingsCoverageSchema>;
export type SavingsActionParams = z.infer<typeof savingsActionParamsSchema>;
export type SavingsOpportunity = z.infer<typeof savingsOpportunitySchema>;
export type SavingsNotAnalysed = z.infer<typeof savingsNotAnalysedSchema>;
export type SavingsReport = z.infer<typeof savingsReportSchema>;
export type SavingsWindow = z.infer<typeof savingsWindowSchema>;
export type SavingsSessionRef = z.infer<typeof savingsSessionRefSchema>;
