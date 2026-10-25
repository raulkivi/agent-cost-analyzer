import type { FindingSeverity, InsightFinding, InsightSessionRow } from "@agent-cost-analyzer/domain";
import { indexRows, type DetectorInput, type FindingDetector } from "./finding-detector.js";

// First appearance of a program, tool or model after a baseline window
// (docs/plans/insights-dashboard.md §4.3): "the agent started doing
// something it never did before".

const MIN_BASELINE = 3;
const BASELINE_SHARE = 0.25;

// Programs whose first use deserves a slightly louder signal.
const RISKY_PROGRAMS = new Set(["nc", "ncat", "netcat", "socat", "ssh", "scp", "curl", "wget", "sudo", "base64", "crontab", "chmod"]);

type Dimension = "program" | "tool" | "model";

interface Occurrence {
  dimension: Dimension;
  value: string;
  turnIndex?: number;
  toolCallKey?: string;
  at?: string;
}

export class BehaviorChangeDetector implements FindingDetector {
  detect({ rows }: DetectorInput): InsightFinding[] {
    const index = indexRows(rows);
    const dated = rows.sessions
      .filter((session): session is InsightSessionRow & { startedAt: string } => session.startedAt !== undefined)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const baselineSize = Math.max(MIN_BASELINE, Math.ceil(dated.length * BASELINE_SHARE));
    if (dated.length <= baselineSize) {
      return [];
    }

    function occurrencesOf(session: InsightSessionRow & { startedAt: string }): Occurrence[] {
      const occurrences: Occurrence[] = [{ dimension: "model", value: session.model, at: session.startedAt }];
      for (const turn of index.turnsBySession.get(session.key) ?? []) {
        occurrences.push({ dimension: "model", value: turn.model, turnIndex: turn.turnIndex, at: session.startedAt });
        for (const call of index.callsByTurn.get(turn.key) ?? []) {
          const where = { turnIndex: turn.turnIndex, toolCallKey: call.key, at: call.startedAt ?? session.startedAt };
          occurrences.push({ dimension: "tool", value: call.name, ...where });
          if (call.program) {
            occurrences.push({ dimension: "program", value: call.program, ...where });
          }
        }
      }
      return occurrences;
    }

    const seen = new Set<string>();
    const remember = (occurrence: Occurrence) => seen.add(`${occurrence.dimension}:${occurrence.value}`);
    dated.slice(0, baselineSize).forEach((session) => occurrencesOf(session).forEach(remember));
    const since = dated[0]!.startedAt.slice(0, 10);

    const findings: InsightFinding[] = [];
    dated.slice(baselineSize).forEach((session, offset) => {
      const earlier = baselineSize + offset;
      for (const occurrence of occurrencesOf(session)) {
        if (seen.has(`${occurrence.dimension}:${occurrence.value}`)) {
          continue;
        }
        remember(occurrence);
        const severity: FindingSeverity =
          occurrence.dimension === "program" && RISKY_PROGRAMS.has(occurrence.value) ? "low" : "info";
        findings.push({
          key: `${session.key}:behavior.new-${occurrence.dimension}:${occurrence.value}`,
          sessionKey: session.key,
          ...(occurrence.turnIndex !== undefined ? { turnIndex: occurrence.turnIndex } : {}),
          ...(occurrence.toolCallKey ? { toolCallKey: occurrence.toolCallKey } : {}),
          kind: "behavior-change",
          category: `new-${occurrence.dimension}`,
          severity,
          ruleId: `behavior.new-${occurrence.dimension}`,
          title: `First use of ${occurrence.dimension} \`${occurrence.value}\``,
          ...(occurrence.at ? { at: occurrence.at } : {}),
          why: `Not used in any of the ${earlier} earlier sessions (since ${since}).`,
        });
      }
    });
    return findings;
  }
}
