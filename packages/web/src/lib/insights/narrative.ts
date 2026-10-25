import type { FailureCategory, InsightFinding } from "@agent-cost-analyzer/domain";
import { CATEGORY_LABELS } from "../audit-format.js";
import { SEVERITY_ORDER } from "./insights-model.js";
import { computeKpis, countBy, type InsightRowsView } from "./measures.js";

// "What happened" — a plain-language summary of the current selection
// (docs/plans/insights-dashboard.md §5): what, when, and what to look at.

const MAX_LISTED = 3;

function joinWithAnd(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function formatWhen(iso: string): string {
  return iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : iso.slice(0, 10);
}

function bySeverityThenLatest(a: InsightFinding, b: InsightFinding): number {
  return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || (b.at ?? "").localeCompare(a.at ?? "");
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function listed(items: string[]): string {
  const shown = items.slice(0, MAX_LISTED);
  return items.length > MAX_LISTED ? `${shown.join("; ")}; and ${items.length - MAX_LISTED} more` : shown.join("; ");
}

export interface NarrativeOptions {
  // false for a single-provider product (ProductProfile, G10): the summary
  // then doesn't say which providers the sessions came from.
  crossProvider?: boolean;
}

export function buildNarrative(view: InsightRowsView, { crossProvider = true }: NarrativeOptions = {}): string[] {
  if (view.sessions.length === 0) {
    return ["No sessions match the current selections."];
  }
  const kpis = computeKpis(view);
  const titleOf = new Map(view.sessions.map((session) => [session.key, session.title]));
  const lines: string[] = [];

  const providers = [...new Set(view.sessions.map((session) => session.providerLabel))];
  const dates = view.sessions.flatMap((session) => (session.date ? [session.date] : [])).sort();
  const span =
    dates.length === 0 ? "" : dates[0] === dates[dates.length - 1] ? `, on ${dates[0]}` : `, ${dates[0]} → ${dates[dates.length - 1]}`;
  const across = crossProvider ? ` across ${joinWithAnd(providers)}` : "";
  lines.push(`${kpis.sessions} session${kpis.sessions === 1 ? "" : "s"}${across}${span}.`);

  if (kpis.turns > 0) {
    const { aiCredits } = kpis;
    if (aiCredits.known === 0) {
      const which = aiCredits.count === 1 ? "the only turn" : `all ${aiCredits.count} turns`;
      lines.push(`AI Credits are unknown for ${which} (the log source did not record usage).`);
    } else {
      const cache = kpis.cacheHitRatio === null ? "" : `; ${percent(kpis.cacheHitRatio)} of input tokens were served from cache`;
      lines.push(
        `They used ${aiCredits.total.toFixed(2)} AI Credits (${aiCredits.known} of ${aiCredits.count} turns with known usage)${cache}.`,
      );
    }
  }

  if (kpis.toolCalls > 0) {
    const made = `Agents made ${kpis.toolCalls} tool call${kpis.toolCalls === 1 ? "" : "s"}`;
    if (kpis.knownOutcomes === 0) {
      lines.push(`${made}; their outcomes were not recorded.`);
    } else if (kpis.failed === 0) {
      lines.push(`${made}; none of the ${kpis.knownOutcomes} with a known outcome failed.`);
    } else {
      const [top] = countBy(view.toolCalls, (call) => call.failureCategory);
      const mostly = top ? `, mostly ${(CATEGORY_LABELS[top.key as FailureCategory] ?? top.key).toLowerCase()} (${top.count})` : "";
      lines.push(`${made}; ${percent(kpis.failureRate!)} of the ${kpis.knownOutcomes} with a known outcome failed${mostly}.`);
    }
  }

  const security = view.findings.filter((finding) => finding.kind === "security").sort(bySeverityThenLatest);
  if (security.length === 0) {
    lines.push("No security signals.");
  } else {
    const counts = SEVERITY_ORDER.map((severity) => [severity, security.filter((finding) => finding.severity === severity).length] as const)
      .filter(([, count]) => count > 0)
      .map(([severity, count]) => `${count} ${severity}`);
    const worst = security[0]!;
    const when = worst.at ? ` on ${formatWhen(worst.at)}` : "";
    lines.push(
      `Signals to review: ${counts.join(", ")}. Most severe: “${worst.title}”${when} in “${titleOf.get(worst.sessionKey) ?? worst.sessionKey}”.`,
    );
  }

  const anomalies = view.findings.filter((finding) => finding.kind === "anomaly").sort(bySeverityThenLatest);
  if (anomalies.length > 0) {
    lines.push(
      `Anomalies: ${listed(anomalies.map((finding) => `“${titleOf.get(finding.sessionKey) ?? finding.sessionKey}”: ${finding.why}`))}`,
    );
  }

  const changes = view.findings
    .filter((finding) => finding.kind === "behavior-change")
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  if (changes.length > 0) {
    lines.push(
      `Behaviour changes: ${listed(changes.map((finding) => `${lowerFirst(finding.title)}${finding.at ? ` (${finding.at.slice(0, 10)})` : ""}`))}.`,
    );
  }
  return lines;
}
