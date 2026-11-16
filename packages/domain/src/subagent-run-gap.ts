// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";
import { subagentLabelSchema, subagentRunIdSchema } from "./subagent-run-ids.js";

// Step 10.20 (docs/plans/subagent-tool-audit.md §6, D12): a run whose tool
// calls are not, or not fully, known. The reader that placed the run states
// why; the audit builder turns it into `AuditedRun.unreadReason`. A gap for a
// run with no calls makes its totals null (never 0); a gap for a run with
// calls only flags it.
export const subagentRunGapSchema = z.object({
  runId: subagentRunIdSchema,
  label: subagentLabelSchema,
  depth: z.number().int().min(1).max(8),
  parentRunId: subagentRunIdSchema.optional(),
  reason: z.string().min(1).max(500),
});

export type SubagentRunGap = z.infer<typeof subagentRunGapSchema>;
