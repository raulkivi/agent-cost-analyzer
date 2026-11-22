// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";
import { tokenCountSchema } from "./token-count.js";

// Step CS4 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/claude-code-subagents.md §5.1, D13): what the three
// subagent summaries add beside their AI Credits figure, so a provider
// without AI Credits (Claude Code) shows tokens and a priced cost instead of
// "unknown". The cost itself is `turnCostFiguresSchema` at each use.

// Each field is a TokenCount: one unknown run keeps the sum unknown, with
// its reason (constraint 6).
export const subagentTokensSchema = z.object({
  uncachedInput: tokenCountSchema,
  cacheWrite: tokenCountSchema,
  cacheRead: tokenCountSchema,
  output: tokenCountSchema,
});

// The same four sums for `SessionCost`, which carries plain numbers: null is
// unknown, never 0.
export const subagentTokenTotalsSchema = z.object({
  uncachedInput: z.number().nullable(),
  cacheWrite: z.number().nullable(),
  cacheRead: z.number().nullable(),
  output: z.number().nullable(),
});

export type SubagentTokens = z.infer<typeof subagentTokensSchema>;
export type SubagentTokenTotals = z.infer<typeof subagentTokenTotalsSchema>;
