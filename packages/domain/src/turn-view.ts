import { z } from "zod";
import { failureCategorySchema, toolCallStatusSchema } from "./tool-call-outcome.js";
import { toolKindSchema } from "./tool-call-record.js";
import { triggeredEventSchema } from "./turn.js";
import { turnUsageSchema } from "./turn-usage.js";

// Phase 9.12 (docs/plans/mcp-tools-v2.md §4/§6): one turn as the MCP
// get_turn tool returns it — free text redacted and bounded, tool calls
// reduced to their outcome and a bounded command excerpt.
export const turnViewToolCallSchema = z.object({
  name: z.string(),
  kind: toolKindSchema,
  status: toolCallStatusSchema,
  failureCategory: failureCategorySchema.optional(),
  exitCode: z.number().int().optional(),
  command: z.string().optional(),
  durationMs: z.number().optional(),
});

export const turnViewSchema = z.object({
  sessionId: z.string(),
  providerId: z.string().optional(),
  turnIndex: z.number(),
  turnCount: z.number(),
  model: z.string(),
  triggeredEvent: triggeredEventSchema.optional(),
  userMessage: z.string(),
  userMessageTruncated: z.boolean(),
  assistantResponse: z.string(),
  assistantResponseTruncated: z.boolean(),
  explanation: z.string(),
  usage: turnUsageSchema,
  toolCalls: z.array(turnViewToolCallSchema),
});

export type TurnView = z.infer<typeof turnViewSchema>;
