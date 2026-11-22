// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { AllowanceSettings, AllowanceSettingsWrite } from "@agent-cost-analyzer/domain";

// Where the monthly allowance is kept (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/monthly-allowance-standalone.md D1).
// Its own port, not more methods on AppSettingsStore: the extension keeps its
// allowance in VS Code settings and must not grow methods it never uses.
export interface AllowanceSettingsStore {
  // Lenient: unusable stored values read as "not set" or the defaults.
  read(): AllowanceSettings;
  // Strict: throws on any out-of-range or unknown field and writes nothing.
  write(settings: AllowanceSettingsWrite): void;
}
