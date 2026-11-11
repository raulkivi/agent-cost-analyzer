// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The real-Copilot run's AI Credits cap (docs/plans/release-ui-gate.md, D12
// proposed). Before every chat the suite sums what the run's chats have cost
// so far (the run log's `credits` entries, which every spec file appends to,
// so the sum spans spec files) and refuses to send once it reaches the cap:
// the test skips with "budget exceeded", and the release gate refuses the skip.
// The cap is checked between chats, so a run can pass it by at most one chat.
import type { RunLogEntry } from "../../../../scripts/release-evidence/build.mts";

export const MAX_AI_CREDITS_ENV = "COPILOT_E2E_MAX_AI_CREDITS";
export const DEFAULT_MAX_AI_CREDITS = 3;
// The parsed cap, passed from the launcher (wdio.copilot.conf.mts) to the workers.
export const MAX_AI_CREDITS_INTERNAL_ENV = "AI_CREDITS_ANALYZER_COPILOT_E2E_MAX_AI_CREDITS";

export type MaxAiCredits = { ok: true; max: number } | { ok: false; reason: string };

export function parseMaxAiCredits(value: string | undefined): MaxAiCredits {
  const text = value?.trim() ?? "";
  if (text === "") return { ok: true, max: DEFAULT_MAX_AI_CREDITS };
  const max = /^\d+(\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isFinite(max)) {
    return { ok: false, reason: `${MAX_AI_CREDITS_ENV} must be a number of AI Credits of at least 0 (0 sends no chat), not "${text}".` };
  }
  return { ok: true, max };
}

export function creditsSpent(log: readonly RunLogEntry[]): number {
  return log.reduce((sum, entry) => (entry.kind === "credits" ? sum + entry.spent : sum), 0);
}

export type BudgetDecision = { send: true; spent: number } | { send: false; reason: string };

export function budgetCheck(log: readonly RunLogEntry[], max: number): BudgetDecision {
  const spent = creditsSpent(log);
  if (spent < max) return { send: true, spent };
  return {
    send: false,
    reason: `AI Credits budget exceeded: the run has spent ${spent.toFixed(4)} of ${MAX_AI_CREDITS_ENV}=${max}; nothing was sent.`,
  };
}
