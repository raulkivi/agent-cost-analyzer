// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { lenientAllowanceSettings, type AllowanceSettings } from "@agent-cost-analyzer/domain";

// Step 10.21 (plan §3.7): the monthly AI Credits allowance the user types,
// read from VS Code settings. The type, defaults and lenient rules are the
// domain's, shared with the standalone app.
export const ALLOWANCE_SETTING_IDS = {
  aiCredits: "aiCreditsAnalyzer.monthlyAllowance.aiCredits",
  resetDay: "aiCreditsAnalyzer.monthlyAllowance.resetDay",
  warnAtPercent: "aiCreditsAnalyzer.monthlyAllowance.warnAtPercent",
} as const;

// The slice of a VS Code configuration the reader needs; the adapter passes
// `workspace.getConfiguration()`, tests a fake.
export interface SettingGetter {
  get(section: string): unknown;
}

// Reads and validates on every call (no caching), so a changed setting shows
// at once. Anything unusable is "not set" or the default, never an error toast
// (the Settings editor already shows range errors).
export function readAllowanceSettings(config: SettingGetter): AllowanceSettings {
  return lenientAllowanceSettings({
    aiCredits: config.get(ALLOWANCE_SETTING_IDS.aiCredits),
    resetDay: config.get(ALLOWANCE_SETTING_IDS.resetDay),
    warnAtPercent: config.get(ALLOWANCE_SETTING_IDS.warnAtPercent),
  });
}
