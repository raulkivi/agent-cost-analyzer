// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { TokenCount } from "@agent-cost-analyzer/domain";

export function formatAiCredits(tokenCount: TokenCount): string {
  return tokenCount.known ? tokenCount.value.toFixed(2) : "—";
}
