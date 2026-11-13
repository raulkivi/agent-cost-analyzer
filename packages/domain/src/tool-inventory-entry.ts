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
});

export type ToolInventoryEntry = z.infer<typeof toolInventoryEntrySchema>;
