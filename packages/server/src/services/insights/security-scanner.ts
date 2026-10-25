import { MAX_EVIDENCE_EXCERPT_LENGTH, type InsightFinding, type ToolCallRecord } from "@agent-cost-analyzer/domain";
import { excerptOf } from "../tool-audit/output-redactor.js";
import { statusOf } from "../tool-audit/outcome-tally.js";
import { resolveToolKind } from "../tool-audit/tool-kind-resolver.js";
import type { DetectorInput, FindingDetector } from "./finding-detector.js";
import { sessionKeyOf, toolCallKeyOf, turnKeyOf } from "./insights-dataset-builder.js";
import { matchSecurityRules, type SecurityRule, type SecuritySubject } from "./security-rules.js";

function subjectOf(call: ToolCallRecord): SecuritySubject {
  const kind = call.kind ?? resolveToolKind(call.name);
  const filePaths = call.filesTouched ?? (kind === "file-read" || kind === "file-write" ? [call.argsSummary] : []);
  return {
    kind,
    name: call.name,
    command: call.shell?.command ?? call.argsSummary,
    paths: filePaths.filter(Boolean),
    status: statusOf(call),
  };
}

// Applies an injected rule table to every tool call (docs/plans/
// insights-dashboard.md §4.1): one finding per (call, matching rule).
export class SecurityScanner implements FindingDetector {
  constructor(private readonly rules: readonly SecurityRule[]) {}

  detect({ sources }: DetectorInput): InsightFinding[] {
    const findings: InsightFinding[] = [];
    for (const source of sources) {
      for (const session of source.sessions) {
        const sessionKey = sessionKeyOf(source.providerId, session.id);
        for (const turn of session.turns) {
          const turnKey = turnKeyOf(sessionKey, turn.index);
          turn.toolCalls.forEach((call, callIndex) => {
            const toolCallKey = toolCallKeyOf(turnKey, callIndex);
            const at = call.startedAt ?? session.startedAt;
            for (const { rule, evidence } of matchSecurityRules(subjectOf(call), this.rules)) {
              findings.push({
                key: `${toolCallKey}:${rule.id}`,
                sessionKey,
                turnIndex: turn.index,
                toolCallKey,
                kind: "security",
                category: rule.category,
                severity: rule.severity,
                ruleId: rule.id,
                title: rule.title,
                ...(at ? { at } : {}),
                why: rule.why,
                evidence: excerptOf(evidence, MAX_EVIDENCE_EXCERPT_LENGTH),
              });
            }
          });
        }
      }
    }
    return findings;
  }
}
