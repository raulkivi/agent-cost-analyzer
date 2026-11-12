// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";
import { harnessSchema } from "./vendor-profile.js";

// Phase 14 step 14.1 (docs/plans/analyze-session-replay.md §4.1): a
// session's main chain as one record per LLM request, numbers only. A
// Copilot or Claude Code "turn" is several requests, and cache reads happen
// between them, so a replay needs this, not the turn sums. No prompt,
// response, tool or path text is ever part of it (strict objects).

const tokens = z.number().int().nonnegative();

// What the log says happened before this request, which the replay turns
// into a script event (§4.2): the prompt shrank (compaction or clear) or
// the model changed.
export const traceEventSchema = z.enum(["compaction", "clear", "model-switch"]);

export const traceRequestSchema = z
  .object({
    // 0, 1, 2… in the order the requests were made.
    index: z.number().int().nonnegative(),
    // The session turn this request belongs to.
    turnIndex: z.number().int().nonnegative(),
    startedAt: z.string().datetime(),
    model: z.string().min(1),
    uncachedInput: tokens,
    cacheRead: tokens,
    // All cache writes, the 1-hour ones included; null when the log doesn't
    // record writes (Copilot's local harness without agent-traces.db), never
    // 0 (constraint 6). Then uncachedInput holds the writes too, and the
    // replay infers them (plan assumption A4).
    cacheWrite: tokens.nullable(),
    // Writes the provider says used the 1-hour lifetime.
    extendedCacheWrite: tokens.optional(),
    output: tokens,
    // Billed as output, never carried into the next prompt (13.5a finding 3).
    reasoning: tokens.optional(),
    event: traceEventSchema.optional(),
  })
  .strict()
  .refine((request) => request.extendedCacheWrite === undefined || (request.cacheWrite !== null && request.extendedCacheWrite <= request.cacheWrite), {
    message: "1-hour cache writes need known cache writes and cannot exceed them",
    path: ["extendedCacheWrite"],
  });

export const untracedTurnSchema = z.object({ turnIndex: z.number().int().nonnegative(), reason: z.string().min(1) }).strict();

export const requestTraceSchema = z
  .object({
    sessionId: z.string().min(1),
    providerId: z.string().min(1),
    harness: harnessSchema,
    requests: z.array(traceRequestSchema),
    // Turns with no usable request (no token counts, a sub-agent only, D6),
    // each with its reason; counted in the replay's coverage (constraint 6).
    notTraced: z.array(untracedTurnSchema),
  })
  .strict()
  .superRefine((trace, ctx) => {
    trace.requests.forEach((request, position) => {
      if (request.index !== position) {
        ctx.addIssue({ code: "custom", path: ["requests", position, "index"], message: `request indexes must be 0, 1, 2… in order (expected ${position})` });
      }
      const previous = trace.requests[position - 1];
      if (!previous) return;
      if (Date.parse(request.startedAt) < Date.parse(previous.startedAt)) {
        ctx.addIssue({ code: "custom", path: ["requests", position, "startedAt"], message: "request times must never go back" });
      }
      if (request.turnIndex < previous.turnIndex) {
        ctx.addIssue({ code: "custom", path: ["requests", position, "turnIndex"], message: "turn indexes must never go back" });
      }
    });
  });

// Phase 16 SR4/SR6: what changed in a request's prompt since the same agent's
// previous prompt (VS Code: the same debugName; Claude Code: the same
// querySource). Each field: true changed, false recorded unchanged, absent not
// recorded by that provider's log. Provider-neutral and a flag only: no prompt
// text or file content is ever part of it.
export interface PromptChangeMarker {
  tools?: boolean;
  systemPrompt?: boolean;
  instructions?: boolean;
}

export type TraceEvent = z.infer<typeof traceEventSchema>;
export type TraceRequest = z.infer<typeof traceRequestSchema>;
export type UntracedTurn = z.infer<typeof untracedTurnSchema>;
export type RequestTrace = z.infer<typeof requestTraceSchema>;
