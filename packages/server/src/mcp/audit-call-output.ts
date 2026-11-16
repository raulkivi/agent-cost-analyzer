// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { toolCallRecordSchema, type AuditedToolCall } from "@agent-cost-analyzer/domain";

// Step 10.20 (docs/plans/subagent-tool-audit.md §9): what a call row may carry
// into MCP output. The record is cut to the schema's fields (anything else a
// reader left on it is dropped), and a subagent-kind call keeps no argument
// summary: its input is the subagent's prompt, which must not reach the model
// (the call still lists its name, kind, outcome and origin).
export function publicAuditedCall({ turnIndex, call }: AuditedToolCall): AuditedToolCall {
  const record = toolCallRecordSchema.parse(call);
  return { turnIndex, call: record.kind === "subagent" ? { ...record, argsSummary: "" } : record };
}
