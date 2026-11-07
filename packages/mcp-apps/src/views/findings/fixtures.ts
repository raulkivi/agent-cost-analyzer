// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { EnrichedFinding, FindingsQueryResult } from "@agent-cost-analyzer/domain";

// Invented findings for the FindingsView tests.

export function enrichedFinding(overrides: Partial<EnrichedFinding> = {}): EnrichedFinding {
  return {
    key: "f1",
    sessionKey: "copilot:s1",
    turnIndex: 8,
    kind: "security",
    category: "credential-access",
    severity: "critical",
    ruleId: "sec-001",
    title: "Read a credentials file",
    at: "2026-10-30T09:00:00Z",
    why: "The command read a file under the deploy config directory.",
    evidence: "$ cat ~/.config/deploy/[REDACTED:path]",
    providerId: "copilot",
    sessionId: "s1",
    sessionTitle: "Rotate deploy keys",
    ...overrides,
  };
}

export function findingsResult(findings: EnrichedFinding[], overrides: Partial<FindingsQueryResult> = {}): FindingsQueryResult {
  return {
    generatedAt: "2026-11-02T12:00:00Z",
    providers: [],
    total: findings.length,
    bySeverity: { info: 0, low: 0, medium: 1, high: 1, critical: 1 },
    findings,
    ...overrides,
  };
}

export const SAMPLE_FINDINGS: EnrichedFinding[] = [
  enrichedFinding(),
  enrichedFinding({
    key: "f2",
    kind: "anomaly",
    category: "cost-outlier",
    severity: "high",
    title: "Turn cost 6.2 x the session median",
    turnIndex: 17,
    at: "2026-10-27T10:00:00Z",
    why: "Turn 17 cost far more than the median turn.",
    evidence: undefined,
    sessionTitle: "Refactor provider registry",
    sessionId: "s2",
  }),
  enrichedFinding({
    key: "f3",
    kind: "price-change",
    category: "price-change",
    severity: "medium",
    title: "claude-haiku-5.5 input price up 12 %",
    turnIndex: undefined,
    at: "2026-10-21T10:00:00Z",
    why: "Billed steadily above the price book.",
    evidence: undefined,
    sessionTitle: "4 sessions",
    sessionId: "s3",
  }),
];
