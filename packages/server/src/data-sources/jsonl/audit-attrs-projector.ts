// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { MAX_ARGS_SUMMARY_LENGTH } from "../../services/tool-audit/args-summary.js";
import type { AttrsProjector } from "./main-jsonl-reader.js";

// Step 10.20 (plan §5.2): the audit read path's own allow-list, as
// turn-inspector-reader.ts has its own. Only the two keys a tool_call span's
// outcome and argument summary need; `result` (arbitrarily large tool output)
// is never kept. The list path (listSessions) never uses this projector.
export const AUDIT_ATTRS_KEYS = ["args", "error"] as const;

export const MAX_AUDIT_ERROR_LENGTH = 2048;

// Cut at parse time so a 50 KB argument string never outlives its line.
const LIMITS: Record<(typeof AUDIT_ATTRS_KEYS)[number], number> = {
  args: MAX_ARGS_SUMMARY_LENGTH,
  error: MAX_AUDIT_ERROR_LENGTH,
};

export const projectAuditAttrs: AttrsProjector = (attrs) => {
  if (typeof attrs !== "object" || attrs === null) {
    return undefined;
  }
  const source = attrs as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  for (const key of AUDIT_ATTRS_KEYS) {
    const value = source[key];
    if (typeof value === "string") {
      projected[key] = value.slice(0, LIMITS[key]);
    }
  }
  return Object.keys(projected).length > 0 ? projected : undefined;
};
