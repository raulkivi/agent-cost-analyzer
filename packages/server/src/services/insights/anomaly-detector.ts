import { isFailedStatus, type InsightFinding, type InsightSessionRow } from "@agent-cost-analyzer/domain";
import { callsOfSession, indexRows, type DetectorInput, type FindingDetector, type RowIndex } from "./finding-detector.js";

// Session-level outliers by robust z-score (docs/plans/insights-dashboard.md
// §4.2): deterministic and explainable — every finding names the value,
// the median and the sample size it was compared against.

export const MIN_SAMPLE = 8;
export const OUTLIER_Z = 3.5;
export const HIGH_SEVERITY_Z = 7;
const MIN_KNOWN_OUTCOMES = 5;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

// 0.6745·(x − median)/MAD (Iglewicz & Hoaglin); null when MAD is 0, since
// there's no spread to call anything an outlier against.
export function robustZScore(value: number, sample: number[]): number | null {
  const center = median(sample);
  const mad = median(sample.map((x) => Math.abs(x - center)));
  return mad === 0 ? null : (0.6745 * (value - center)) / mad;
}

interface Metric {
  id: string; // category: `${id}-outlier`
  label: string;
  format(value: number): string;
  // null = this session has no known value for the metric (excluded from the sample)
  valueOf(session: InsightSessionRow, index: RowIndex): number | null;
}

function sumKnown(values: (number | null)[]): number | null {
  return values.length > 0 && values.every((value) => value !== null)
    ? values.reduce<number>((sum, value) => sum + value!, 0)
    : null;
}

const METRICS: Metric[] = [
  {
    id: "cost",
    label: "AI Credits",
    format: (value) => value.toFixed(2),
    valueOf: (session, index) => sumKnown((index.turnsBySession.get(session.key) ?? []).map((turn) => turn.aiCredits)),
  },
  {
    id: "output",
    label: "Output tokens",
    format: (value) => Math.round(value).toLocaleString("en-US"),
    valueOf: (session, index) => sumKnown((index.turnsBySession.get(session.key) ?? []).map((turn) => turn.output)),
  },
  {
    id: "tool-volume",
    label: "Tool calls",
    format: (value) => String(value),
    valueOf: (session, index) => callsOfSession(index, session).length,
  },
  {
    id: "failure-rate",
    label: "Tool-call failure rate",
    format: (value) => `${Math.round(value * 100)}%`,
    valueOf: (session, index) => {
      const known = callsOfSession(index, session).filter((call) => call.status !== "unknown");
      return known.length >= MIN_KNOWN_OUTCOMES
        ? known.filter((call) => isFailedStatus(call.status)).length / known.length
        : null;
    },
  },
];

function explain(metric: Metric, value: number, center: number, n: number, z: number): string {
  const ratio = center > 0 ? ` is ${(value / center).toFixed(1)}× the median ${metric.format(center)}` : ` is above the median ${metric.format(center)}`;
  return `${metric.label} ${metric.format(value)}${ratio} across ${n} sessions (robust z = ${z.toFixed(1)}).`;
}

export class AnomalyDetector implements FindingDetector {
  detect({ rows }: DetectorInput): InsightFinding[] {
    const index = indexRows(rows);
    const findings: InsightFinding[] = [];
    for (const metric of METRICS) {
      const measured = rows.sessions
        .map((session) => ({ session, value: metric.valueOf(session, index) }))
        .filter((entry): entry is { session: InsightSessionRow; value: number } => entry.value !== null);
      if (measured.length < MIN_SAMPLE) {
        continue;
      }
      const sample = measured.map((entry) => entry.value);
      const center = median(sample);
      for (const { session, value } of measured) {
        const z = robustZScore(value, sample);
        if (z === null || z <= OUTLIER_Z) {
          continue;
        }
        findings.push({
          key: `${session.key}:anomaly.${metric.id}-outlier`,
          sessionKey: session.key,
          kind: "anomaly",
          category: `${metric.id}-outlier`,
          severity: z > HIGH_SEVERITY_Z ? "high" : "medium",
          ruleId: `anomaly.${metric.id}-outlier`,
          title: `Unusually high ${metric.label.toLowerCase()}`,
          ...(session.startedAt ? { at: session.startedAt } : {}),
          why: explain(metric, value, center, measured.length, z),
        });
      }
    }
    return findings;
  }
}
