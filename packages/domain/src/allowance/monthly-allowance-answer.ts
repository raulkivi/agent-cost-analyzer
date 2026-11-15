// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";
import { isoCalendarDateSchema } from "../price-book.js";
import { copilotHarnessSchema } from "../session.js";
import { allowanceSettingsSchema } from "./allowance-settings.js";
import { ALLOWANCE_LEVELS } from "./monthly-allowance.js";

// What GET /api/monthly-allowance and MCP get_monthly_allowance answer
// (monthly-allowance-standalone.md §4.6). Numbers, day keys, the zone and
// fixed labels only: no session id, title, path or repository name, so every
// object is strict. Unknown is never 0: `used` exists only in the known
// state, which needs a session with cost data.

const count = z.number().int().nonnegative();
const credits = z.number().nonnegative();

export const allowanceStateSchema = z.enum(["not-set", "no-source", "no-sessions", "unknown", "known"]);
export type AllowanceState = z.infer<typeof allowanceStateSchema>;

export const allowanceLevelSchema = z.enum(ALLOWANCE_LEVELS);

export const allowancePeriodSchema = z
  .object({
    startKey: isoCalendarDateSchema,
    endKeyExclusive: isoCalendarDateSchema,
    timeZone: z.string().min(1), // IANA; the days are calendar days there
    daysLeft: z.number().int().positive(), // inclusive of today
    dayOfPeriod: z.number().int().positive(),
  })
  .strict();

const coverageSchema = z.object({ known: count, total: count }).strict();

export const knownAllowanceFiguresSchema = z
  .object({
    level: allowanceLevelSchema,
    used: credits,
    atLeast: z.boolean(),
    percent: count, // rounded down
    remaining: credits, // "up to"
    coverage: coverageSchema,
    countedSinceKey: isoCalendarDateSchema,
  })
  .strict();

// The unknown and no-sessions states: how many sessions, never a sum.
export const coverageOnlyFiguresSchema = z
  .object({
    coverage: coverageSchema,
    countedSinceKey: isoCalendarDateSchema.optional(),
  })
  .strict();

export const copilotVariantSchema = z.enum(["VS Code", "VS Code Insiders"]);

export const harnessFiguresSchema = z
  .object({
    harness: copilotHarnessSchema,
    known: count,
    total: count,
    used: credits.nullable(), // null: none of them has cost data
  })
  .strict();

export const copilotSourceSchema = z
  .object({
    providerId: z.literal("vscode"),
    available: z.boolean(),
    reason: z.string().min(1).optional(),
    variant: copilotVariantSchema.nullable(), // a fixed label, never the path
    byHarness: z.array(harnessFiguresSchema),
  })
  .strict();

function checkCoverage({ known, total }: { known: number; total: number }, path: (string | number)[], ctx: z.RefinementCtx) {
  if (known > total) {
    ctx.addIssue({ code: "custom", path, message: "more sessions with cost data than sessions" });
  }
}

const FIGURES_BY_STATE: Record<AllowanceState, "known" | "coverage" | "none"> = {
  "not-set": "none",
  "no-source": "none",
  "no-sessions": "coverage",
  unknown: "coverage",
  known: "known",
};

// The top level stays an object (an MCP tool's output schema must be one);
// which figures go with which state is checked here instead of by a union.
export const monthlyAllowanceAnswerSchema = z
  .object({
    settings: allowanceSettingsSchema,
    state: allowanceStateSchema,
    period: allowancePeriodSchema,
    figures: z.union([knownAllowanceFiguresSchema, coverageOnlyFiguresSchema]).optional(),
    source: copilotSourceSchema,
    asOf: z.iso.datetime(),
  })
  .strict()
  .superRefine((answer, ctx) => {
    const { state, figures, settings, source } = answer;
    if ((state === "not-set") !== (settings.aiCredits === null)) {
      ctx.addIssue({ code: "custom", path: ["state"], message: "not-set exactly when the allowance is null" });
    }
    if (state !== "not-set" && (state === "no-source") === source.available) {
      ctx.addIssue({ code: "custom", path: ["state"], message: "no-source exactly when the Copilot logs are unavailable" });
    }
    source.byHarness.forEach((harness, index) => {
      checkCoverage(harness, ["source", "byHarness", index], ctx);
      if ((harness.used === null) !== (harness.known === 0)) {
        ctx.addIssue({ code: "custom", path: ["source", "byHarness", index, "used"], message: "a sum exactly when a session has cost data" });
      }
    });

    const kind = figures === undefined ? "none" : "used" in figures ? "known" : "coverage";
    if (kind !== FIGURES_BY_STATE[state]) {
      ctx.addIssue({ code: "custom", path: ["figures"], message: `the ${state} state has ${FIGURES_BY_STATE[state]} figures` });
      return;
    }
    if (figures === undefined) {
      return;
    }
    const { coverage } = figures;
    checkCoverage(coverage, ["figures", "coverage"], ctx);
    if (state === "known" && "used" in figures) {
      if (coverage.known === 0) {
        ctx.addIssue({ code: "custom", path: ["figures", "coverage"], message: "a sum needs a session with cost data" });
      }
      if (figures.atLeast !== coverage.known < coverage.total) {
        ctx.addIssue({ code: "custom", path: ["figures", "atLeast"], message: "at least exactly when a session has no cost data" });
      }
    }
    if (state === "unknown" && (coverage.known !== 0 || coverage.total === 0 || figures.countedSinceKey === undefined)) {
      ctx.addIssue({ code: "custom", path: ["figures"], message: "unknown: sessions, none with cost data" });
    }
    if (state === "no-sessions" && (coverage.total !== 0 || figures.countedSinceKey !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["figures"], message: "no-sessions: no session in the period" });
    }
  });

export type MonthlyAllowanceAnswer = z.infer<typeof monthlyAllowanceAnswerSchema>;
