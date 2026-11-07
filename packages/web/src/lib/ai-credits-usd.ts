// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
const USD_PER_AI_CREDIT = 0.01;

export function aiCreditsToUsd(credits: number): number {
  return credits * USD_PER_AI_CREDIT;
}

// Sub-cent costs are common in Learn scenarios, so up to 4 decimals show,
// but never fewer than 2 (so $1.50, not $1.5).
export function formatUsd(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd > 0 && usd < 0.00005) return "<$0.0001";
  const [whole, decimals = ""] = usd.toFixed(4).split(".");
  const trimmed = decimals.replace(/0+$/, "").padEnd(2, "0");
  return `$${whole}.${trimmed}`;
}
