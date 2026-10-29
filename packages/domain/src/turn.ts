import { z } from "zod";
import { toolCallRecordSchema } from "./tool-call-record.js";
import { turnUsageSchema } from "./turn-usage.js";

export const triggeredEventSchema = z.enum([
  "model-switch",
  "tool-change",
  "compaction",
  "clear",
  "rewind",
  "fork",
  "cache-expiry",
  "instructions-change",
  "image-change",
  "reasoning-toggle",
]);

export const turnSchema = z.object({
  index: z.number(),
  userMessage: z.string(),
  assistantResponse: z.string(),
  toolCalls: z.array(toolCallRecordSchema),
  usage: turnUsageSchema,
  explanation: z.string(),
  triggeredEvent: triggeredEventSchema.optional(),
  // Set when the provider couldn't read this turn's text / tool calls (e.g.
  // an Agent Host turn the Copilot CLI event log can't be matched to), so
  // the empty values read as unknown, not as empty (constraint 6).
  textUnavailableReason: z.string().optional(),
  toolCallsUnavailableReason: z.string().optional(),
});

export type TriggeredEvent = z.infer<typeof triggeredEventSchema>;
export type Turn = z.infer<typeof turnSchema>;
