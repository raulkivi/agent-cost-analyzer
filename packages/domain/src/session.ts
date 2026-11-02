import { z } from "zod";
import { systemPromptComponentSchema } from "./system-prompt-component.js";
import { tokenCountSchema } from "./token-count.js";
import { toolInventoryEntrySchema } from "./tool-inventory-entry.js";
import { turnSchema } from "./turn.js";

// Which Copilot store a VS Code session came from: the classic chat session
// store, or VS Code's Agent Host (1.143+), which records tokens and AI
// Credits per turn; its turn text, tool calls and system prompt come from
// the Copilot CLI event log (see copilotEventLog).
export const copilotHarnessSchema = z.enum(["local", "agent-host"]);

export type CopilotHarness = z.infer<typeof copilotHarnessSchema>;

// Agent Host sessions only (step 10.14): whether the Copilot CLI event log,
// which holds their turn text, tool calls and system prompt, was read. Only
// "read" makes an empty tool-call list mean "no calls"; the others carry the
// reason they're unknown. Absent on a list summary, which never opens the log.
export const copilotEventLogStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("read") }),
  z.object({ status: z.literal("missing"), reason: z.string() }),
  z.object({ status: z.literal("unreadable"), reason: z.string() }),
]);

export type CopilotEventLogStatus = z.infer<typeof copilotEventLogStatusSchema>;

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
  copilotHarness: copilotHarnessSchema.optional(), // VS Code (Copilot) sessions only
  copilotEventLog: copilotEventLogStatusSchema.optional(), // Agent Host sessions only
});

export type Session = z.infer<typeof sessionSchema>;
