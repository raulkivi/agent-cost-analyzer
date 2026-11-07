// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";

// Analyze mode only
export const toolInventoryEntrySchema = z.object({
  name: z.string(),
  loaded: z.boolean(),
  invokedInTurns: z.array(z.number()),
});

export type ToolInventoryEntry = z.infer<typeof toolInventoryEntrySchema>;
