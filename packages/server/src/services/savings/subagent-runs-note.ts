// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SavingsOpportunity } from "@agent-cost-analyzer/domain";
import type { DetectorResult, SavingsSessionInput } from "./savings-detector.js";

// Step CS11 (docs/plans/claude-code-subagents.md D10): the savings read the
// main agent only in 1.0. A row says how many subagent runs its sessions
// started, so the saving is never read as covering them. Only a session whose
// provider records the runs' tokens (Claude Code) carries the count; Copilot's
// rows are unchanged. The sessions were analyzed (for the main agent), so
// `sessionsAnalysed` is unchanged. The tool-call count is subagent-calls-note.ts's.

export function subagentRunsIn({ session }: SavingsSessionInput): number {
  return session.subagentSpend?.tokens === undefined ? 0 : session.subagentSpend.runs;
}

function withNote(opportunity: SavingsOpportunity, runsBySession: ReadonlyMap<string, number>): SavingsOpportunity {
  let runs = 0;
  let affected = 0;
  for (const { providerId, sessionId } of opportunity.sessions) {
    const count = runsBySession.get(`${providerId}\u0000${sessionId}`) ?? 0;
    runs += count;
    if (count > 0) affected += 1;
  }
  if (runs === 0) return opportunity;
  const reason = `${runs} subagent ${runs === 1 ? "run" : "runs"} not analyzed: this saving reads main-agent usage only.`;
  const { coverage } = opportunity;
  return { ...opportunity, coverage: { ...coverage, notAnalysed: [...coverage.notAnalysed, { reason, sessions: affected }] } };
}

export function withSubagentRunsNote(result: DetectorResult, sessions: readonly SavingsSessionInput[]): DetectorResult {
  const runsBySession = new Map(sessions.map((input) => [`${input.providerId}\u0000${input.session.id}`, subagentRunsIn(input)]));
  if (![...runsBySession.values()].some((runs) => runs > 0)) return result;
  return { ...result, opportunities: result.opportunities.map((opportunity) => withNote(opportunity, runsBySession)) };
}
