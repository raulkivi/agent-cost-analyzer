// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";

// A per-turn analog of SystemPromptComponent (architecture.md §4.2), scoped
// to one turn's actual LLM request/response round-trip(s) rather than the
// session-level system prompt. Deliberately not a field on Turn itself —
// GET /api/sessions/:id already sends every turn up front, and this content
// can be arbitrarily large (raw prompt/tool-call payloads), so it's fetched
// on demand via GET /api/sessions/:id/turns/:turnIndex instead.
export const contentPlaceholderSchema = z.object({
  placeholder: z.literal(true),
  kind: z.enum(["file", "image"]),
  path: z.string().optional(),
  sizeBytes: z.number().optional(),
});

export type ContentPlaceholder = z.infer<typeof contentPlaceholderSchema>;

export const messageContentPartSchema = z.union([
  z.object({ kind: z.literal("text"), text: z.string() }),
  contentPlaceholderSchema,
]);

export type MessageContentPart = z.infer<typeof messageContentPartSchema>;

// A later log entry changed what the model saw of this part (pi's
// `context_edit`): "omitted" left it out of every later request, "replaced"
// swapped its content. Raw history and usage are unchanged, so the part's
// tokens still count.
export const contextEditSchema = z.object({
  kind: z.enum(["omitted", "replaced"]),
  note: z.string(),
});

export type ContextEdit = z.infer<typeof contextEditSchema>;

const toolCallPartSchema = z.object({
  name: z.string(),
  args: z.array(messageContentPartSchema),
  result: z.array(messageContentPartSchema),
  contextEdit: contextEditSchema.optional(),
});

const turnRequestRoundSchema = z.object({
  index: z.number(),
  addedMessages: z.array(messageContentPartSchema),
  toolCalls: z.array(toolCallPartSchema),
});

const turnResponseRoundSchema = z.object({
  index: z.number(),
  response: z.array(messageContentPartSchema),
  reasoning: z.array(messageContentPartSchema).optional(),
  contextEdit: contextEditSchema.optional(),
});

// rounds: [] is a valid, non-error value — it means this turn genuinely made
// no model request, not that data is missing — unless unavailableReason is
// set, which says the rounds are unknown and why (constraint 6).
export const turnInspectorDetailSchema = z.object({
  turnIndex: z.number(),
  userMessage: z.array(messageContentPartSchema),
  rounds: z.array(
    z.object({
      request: turnRequestRoundSchema,
      response: turnResponseRoundSchema,
    }),
  ),
  unavailableReason: z.string().optional(),
});

export type TurnInspectorDetail = z.infer<typeof turnInspectorDetailSchema>;
