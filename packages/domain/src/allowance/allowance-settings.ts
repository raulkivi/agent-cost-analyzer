// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";

// The monthly AI Credits allowance the user types (step 10.21, MA13). Where
// it is stored is each product's adapter: VS Code settings in the extension,
// the app's settings.json in the standalone app.

export const DEFAULT_RESET_DAY = 1;
export const DEFAULT_WARN_AT_PERCENT = 80;

// A sanity cap on what a write accepts, not a plan amount.
export const MAX_ALLOWANCE_AI_CREDITS = 1_000_000_000;

const resetDay = z.number().int().min(1).max(28); // every month has it
const warnAtPercent = z.number().int().min(1).max(100);

// The settings as read. aiCredits null: not set, the gauge stays hidden.
export const allowanceSettingsSchema = z
  .object({
    aiCredits: z.number().positive().nullable(),
    resetDay,
    warnAtPercent,
  })
  .strict();

export type AllowanceSettings = z.infer<typeof allowanceSettingsSchema>;

// What a write must send: the whole object, nothing else, within range.
// null removes the allowance and keeps the reset day and the threshold.
export const allowanceSettingsWriteSchema = allowanceSettingsSchema
  .extend({ aiCredits: z.number().positive().max(MAX_ALLOWANCE_AI_CREDITS).nullable() })
  .strict();

export type AllowanceSettingsWrite = z.infer<typeof allowanceSettingsWriteSchema>;

function integerInRange(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

// The lenient read: anything unusable is "not set" or the default, never an
// error and never a figure the user did not type. `raw` is whatever the
// store holds; only its three keys are read.
export function lenientAllowanceSettings(raw: unknown): AllowanceSettings {
  const values: Record<string, unknown> = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const allowance = values.aiCredits;
  return {
    aiCredits: typeof allowance === "number" && Number.isFinite(allowance) && allowance > 0 ? allowance : null,
    resetDay: integerInRange(values.resetDay, 1, 28, DEFAULT_RESET_DAY),
    warnAtPercent: integerInRange(values.warnAtPercent, 1, 100, DEFAULT_WARN_AT_PERCENT),
  };
}
