import { z } from "zod";
import { toolCallRecordSchema } from "./tool-call-record.js";
import { turnSimulationSchema } from "./simulation.js";
import { turnUsageSchema } from "./turn-usage.js";
import { sessionWorkspaceSchema } from "./workspace.js";

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
  simulation: turnSimulationSchema.optional(),
  // Analyze mode only (Phase 15 step 15.1): when the turn started, as the
  // log records it (ISO 8601), so it can be priced at the price in force then.
  startedAt: z.string().min(1).optional(),
  // Only where this turn ran in another folder than the session's (Claude
  // Code records the folder per entry); otherwise the session's applies.
  workspace: sessionWorkspaceSchema.optional(),
});

export type TriggeredEvent = z.infer<typeof triggeredEventSchema>;
export type Turn = z.infer<typeof turnSchema>;
