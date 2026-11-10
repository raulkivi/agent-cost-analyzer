// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// The server ranks by AI Credits only when every turn has them, otherwise by
// input tokens (cost-aggregation `rankingFor`). The views must say which, or a
// table of "Unknown" credits looks arbitrarily ordered.
export type RankedBy = "aiCredits" | "inputTokens";

export function rankingLabel(rankedBy: RankedBy): string {
  return rankedBy === "inputTokens" ? "input tokens" : "AI Credits";
}
