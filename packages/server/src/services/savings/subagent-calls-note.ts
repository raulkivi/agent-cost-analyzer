// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SavingsCoverage } from "@agent-cost-analyzer/domain";
import { isSubagentCall } from "../tool-audit/outcome-tally.js";
import type { SavingsSessionInput } from "./savings-detector.js";

// Step 10.20 D7 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/subagent-tool-audit.md section 5.6): the tool-call
// savings detectors read main-agent calls only in 1.0. A row says how many
// subagent calls its sessions held and it left out, so the saving is never
// read as covering them. The sessions were analyzed (for the main agent), so
// `sessionsAnalysed` is unchanged.

export function subagentCallsIn(session: SavingsSessionInput): number {
  return session.audit?.calls.filter(({ call }) => isSubagentCall(call)).length ?? 0;
}

export function withSubagentCallsNote(coverage: SavingsCoverage, sessions: Iterable<SavingsSessionInput>): SavingsCoverage {
  let calls = 0;
  let affected = 0;
  for (const session of sessions) {
    const count = subagentCallsIn(session);
    calls += count;
    if (count > 0) affected += 1;
  }
  if (calls === 0) return coverage;
  const reason = `${calls} subagent tool ${calls === 1 ? "call" : "calls"} not analyzed: this saving reads main-agent calls only.`;
  return { ...coverage, notAnalysed: [...coverage.notAnalysed, { reason, sessions: affected }] };
}
