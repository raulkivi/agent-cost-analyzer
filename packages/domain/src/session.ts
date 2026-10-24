import { z } from "zod";
import { systemPromptComponentSchema } from "./system-prompt-component.js";
import { tokenCountSchema } from "./token-count.js";
import { toolInventoryEntrySchema } from "./tool-inventory-entry.js";
import { turnSchema } from "./turn.js";

export const sessionSchema = z.object({
  id: z.string(),
  mode: z.enum(["learn", "analyze"]),
  providerId: z.string().optional(), // Analyze mode only — id of the log provider that produced this session
  title: z.string(),
  model: z.string(),
  turns: z.array(turnSchema),
  turnCount: z.number(),
  costAiCredits: tokenCountSchema,
  systemPrompt: z.array(systemPromptComponentSchema).optional(), // Analyze mode only
  toolInventory: z.array(toolInventoryEntrySchema).optional(), // Analyze mode only
  usageDataAvailable: z.boolean(),
  category: z.string().optional(), // Learn mode only — authored per fixture
  startedAt: z.string().optional(), // Analyze mode only — ISO date from sessions.created_at
});

export type Session = z.infer<typeof sessionSchema>;
