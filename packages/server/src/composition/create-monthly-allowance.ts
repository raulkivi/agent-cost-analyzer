// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { FileAllowanceSettingsStore } from "../data-sources/log-providers/file-allowance-settings-store.js";
import type { LogProviderRegistry } from "../data-sources/log-providers/registry.js";
import { MonthlyAllowanceService, variantOfUserDataDir } from "../services/monthly-allowance/monthly-allowance-service.js";

export interface MonthlyAllowanceCompositionOptions {
  // The user-data dir every Copilot path derives from; null: none found.
  agentHostUserDataDir: string | null;
  now?: () => Date;
  timeZone?: string;
}

// The monthly allowance as both standalone entry points wire it (the HTTP app
// and the stdio MCP server), so the header and get_monthly_allowance agree:
// the VS Code provider's sessions whatever provider is active (MS4 D5),
// against the allowance in settings.json.
export function createMonthlyAllowance(
  registry: LogProviderRegistry,
  appSettingsDir: string,
  { agentHostUserDataDir, now, timeZone }: MonthlyAllowanceCompositionOptions,
): MonthlyAllowanceService {
  return new MonthlyAllowanceService({
    settings: new FileAllowanceSettingsStore(appSettingsDir),
    copilot: registry.getProvider("vscode"),
    now: now ?? (() => new Date()),
    timeZone: timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    variant: variantOfUserDataDir(agentHostUserDataDir),
  });
}
