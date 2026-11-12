// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// Step 10.21 (plan §3.7): the monthly AI Credits allowance the user types.
export const ALLOWANCE_SETTING_IDS = {
  aiCredits: "aiCreditsAnalyzer.monthlyAllowance.aiCredits",
  resetDay: "aiCreditsAnalyzer.monthlyAllowance.resetDay",
  warnAtPercent: "aiCreditsAnalyzer.monthlyAllowance.warnAtPercent",
} as const;

export const DEFAULT_RESET_DAY = 1;
export const DEFAULT_WARN_AT_PERCENT = 80;

export interface AllowanceSettings {
  aiCredits: number | null; // null: not set, the gauge stays hidden
  resetDay: number; // 1 to 28
  warnAtPercent: number; // 1 to 100
}

// The slice of a VS Code configuration the reader needs; the adapter passes
// `workspace.getConfiguration()`, tests a fake.
export interface SettingGetter {
  get(section: string): unknown;
}

function integerInRange(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

// Reads and validates on every call (no caching), so a changed setting shows
// at once. Anything unusable is "not set" or the default, never an error toast
// (the Settings editor already shows range errors).
export function readAllowanceSettings(config: SettingGetter): AllowanceSettings {
  const allowance = config.get(ALLOWANCE_SETTING_IDS.aiCredits);
  return {
    aiCredits: typeof allowance === "number" && Number.isFinite(allowance) && allowance > 0 ? allowance : null,
    resetDay: integerInRange(config.get(ALLOWANCE_SETTING_IDS.resetDay), 1, 28, DEFAULT_RESET_DAY),
    warnAtPercent: integerInRange(config.get(ALLOWANCE_SETTING_IDS.warnAtPercent), 1, 100, DEFAULT_WARN_AT_PERCENT),
  };
}
