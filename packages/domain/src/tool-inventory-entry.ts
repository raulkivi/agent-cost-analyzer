// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";
import { tokenCountSchema } from "./token-count.js";

// Analyze mode only
export const toolInventoryEntrySchema = z.object({
  name: z.string(),
  loaded: z.boolean(),
  invokedInTurns: z.array(z.number()),
  // Phase 16 SR2: tokens this tool's definition adds to each request, a
  // local-tokenizer estimate; unknown, with the reason, when the definition
  // is not in the log (never 0).
  definitionTokens: tokenCountSchema.optional(),
  // V27 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/savings-increment-3.md §7.1): the requests the tool was declared for
  // when the log shows the list changing mid-session (pi); absent means every
  // request of the session. A removed tool keeps its last definition.
  loadedRequests: z.number().int().nonnegative().optional(),
});

export type ToolInventoryEntry = z.infer<typeof toolInventoryEntrySchema>;
