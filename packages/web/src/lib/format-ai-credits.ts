// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { TokenCount } from "@agent-cost-analyzer/domain";

// The rounding rule for a known AI Credits amount: 2 decimal places. Split
// out so callers holding a plain number (the MCP Apps view models) share it.
export function formatAiCreditsValue(value: number): string {
  return value.toFixed(2);
}

export function formatAiCredits(tokenCount: TokenCount): string {
  return tokenCount.known ? formatAiCreditsValue(tokenCount.value) : "—";
}
