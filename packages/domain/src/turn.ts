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
});

export type TriggeredEvent = z.infer<typeof triggeredEventSchema>;
export type Turn = z.infer<typeof turnSchema>;
