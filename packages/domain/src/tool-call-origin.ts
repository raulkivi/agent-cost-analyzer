// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";
import { subagentLabelSchema, subagentRunIdSchema } from "./subagent-run-ids.js";

// Step 10.20 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/subagent-tool-audit.md §5.1): which agent issued a
// tool call. A record without `origin` is the main agent's, so Learn
// fixtures, pi, mitmproxy and old clients stay valid.
export const toolCallOriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("main") }),
  z.object({
    kind: z.literal("subagent"),
    runId: subagentRunIdSchema, // equals TurnUsage.subagents[].id where the cost side has the run
    label: subagentLabelSchema,
    depth: z.number().int().min(1).max(8), // 1 = started by the main agent
    parentRunId: subagentRunIdSchema.optional(), // set when depth > 1
    // The main or outer call that started the run, when the log names one.
    startedByCallId: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/).optional(),
  }),
]);

export type ToolCallOrigin = z.infer<typeof toolCallOriginSchema>;
