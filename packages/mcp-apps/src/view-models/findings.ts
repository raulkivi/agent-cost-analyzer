// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { FindingKind, FindingSeverity, FindingsQueryResult } from "@agent-cost-analyzer/domain";
import { formatCount, formatDay, pluralize } from "./format.js";

// U3, findings (docs/plans/mcp-apps.md §4.3). Pure: formats a list_findings
// result for display. The filter is the part of the tool's arguments the
// view offers (kind and minimum severity); the server's own filter type is a
// superset, so it is assignable here.
//
// `detail` holds the detector's explanation and the redacted evidence:
// logged text, shown to the user inside the card only. It must never be put
// into a sendMessage or the model context (§6).

export interface FindingsFilter {
  kind?: FindingKind[];
  minSeverity?: FindingSeverity;
}

export interface SeverityTile {
  severity: FindingSeverity;
  label: string;
  count: number;
  countText: string;
  dimmed: boolean; // below the minimum severity filter
}

export interface FilterOption<Value extends string> {
  value: Value | "all";
  label: string;
  selected: boolean;
}

export interface FindingRow {
  key: string;
  title: string;
  severity: FindingSeverity;
  severityLabel: string;
  kind: FindingKind;
  kindLabel: string;
  inferred: boolean; // an observed price change: carries the "inferred" tag
  providerId: string;
  sessionId: string;
  sessionTitle: string;
  turnText?: string;
  whenText?: string;
  detail: { why: string; evidence?: string }; // logged text: display only
}

export interface FindingsViewModel {
  summaryText: string;
  shownText?: string;
  filterText?: string;
  emptyText?: string;
  severityTiles: SeverityTile[];
  kindOptions: FilterOption<FindingKind>[];
  severityOptions: FilterOption<FindingSeverity>[];
  rows: FindingRow[];
}

const SEVERITIES_MOST_SEVERE_FIRST: readonly FindingSeverity[] = ["critical", "high", "medium", "low", "info"];
const SEVERITY_RANK: Record<FindingSeverity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const SEVERITY_LABEL: Record<FindingSeverity, string> = { info: "Info", low: "Low", medium: "Medium", high: "High", critical: "Critical" };
const MIN_SEVERITY_LABEL: Record<FindingSeverity, string> = {
  info: "All severities",
  low: "Low and above",
  medium: "Medium and above",
  high: "High and above",
  critical: "Critical only",
};
const KIND_LABEL: Record<FindingKind, string> = {
  security: "Security",
  anomaly: "Anomaly",
  "behavior-change": "Behaviour change",
  "price-change": "Price change",
};
const KINDS: readonly FindingKind[] = ["security", "anomaly", "behavior-change", "price-change"];

export function toFindingsViewModel(result: FindingsQueryResult, filter: FindingsFilter): FindingsViewModel {
  const kinds = filter.kind ?? [];
  // A minimum of "info" excludes nothing, so it reads as no severity filter.
  const minSeverity = filter.minSeverity !== undefined && filter.minSeverity !== "info" ? filter.minSeverity : undefined;
  const minRank = minSeverity === undefined ? 0 : SEVERITY_RANK[minSeverity];

  const activeFilters = [
    ...kinds.map((kind) => KIND_LABEL[kind]),
    ...(minSeverity === undefined ? [] : [MIN_SEVERITY_LABEL[minSeverity]]),
  ];

  const viewModel: FindingsViewModel = {
    summaryText: pluralize(result.total, "finding"),
    severityTiles: SEVERITIES_MOST_SEVERE_FIRST.map((severity) => ({
      severity,
      label: SEVERITY_LABEL[severity],
      count: result.bySeverity[severity],
      countText: formatCount(result.bySeverity[severity]),
      dimmed: SEVERITY_RANK[severity] < minRank,
    })),
    kindOptions: [
      { value: "all", label: "All", selected: kinds.length === 0 },
      ...KINDS.map((kind) => ({ value: kind, label: KIND_LABEL[kind], selected: kinds.includes(kind) })),
    ],
    severityOptions: [
      { value: "all", label: MIN_SEVERITY_LABEL.info, selected: minSeverity === undefined },
      ...(["low", "medium", "high", "critical"] as const).map((severity) => ({
        value: severity,
        label: MIN_SEVERITY_LABEL[severity],
        selected: minSeverity === severity,
      })),
    ],
    rows: result.findings.map((finding): FindingRow => {
      const turnText = finding.turnIndex === undefined ? undefined : `turn ${finding.turnIndex}`;
      const whenText = formatDay(finding.at);
      return {
        key: finding.key,
        title: finding.title,
        severity: finding.severity,
        severityLabel: SEVERITY_LABEL[finding.severity],
        kind: finding.kind,
        kindLabel: KIND_LABEL[finding.kind],
        inferred: finding.kind === "price-change",
        providerId: finding.providerId,
        sessionId: finding.sessionId,
        sessionTitle: finding.sessionTitle,
        ...(turnText === undefined ? {} : { turnText }),
        ...(whenText === undefined ? {} : { whenText }),
        detail: { why: finding.why, ...(finding.evidence === undefined ? {} : { evidence: finding.evidence }) },
      };
    }),
  };
  if (result.findings.length < result.total) {
    viewModel.shownText = `Showing ${formatCount(result.findings.length)} of ${formatCount(result.total)}, most severe first`;
  }
  if (activeFilters.length > 0) viewModel.filterText = activeFilters.join(", ");
  if (result.findings.length === 0) viewModel.emptyText = "No findings match these filters.";
  return viewModel;
}
