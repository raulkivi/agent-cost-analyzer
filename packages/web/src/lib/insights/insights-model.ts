import type {
  FailureCategory,
  FindingKind,
  FindingSeverity,
  InsightFinding,
  InsightSessionRow,
  InsightsDataset,
  InsightToolCallRow,
  InsightTurnRow,
  ToolCallStatus,
  TriggeredEvent,
} from "@copilot-cost-analyzer/domain";
import type { AssociativeModel, FieldDef } from "../associative/data-model.js";
import { CATEGORY_LABELS, STATUS_META } from "../audit-format.js";
import { TRIGGER_LABELS } from "../trigger-labels.js";

// The insights dashboard's associative model (docs/plans/insights-dashboard.md
// §3/§5): sessions ← turns ← toolCalls, sessions ← findings.

export const TABLE = { sessions: "sessions", turns: "turns", toolCalls: "toolCalls", findings: "findings" } as const;

export const FIELD = {
  provider: "provider",
  date: "date",
  hour: "hour",
  session: "session",
  model: "model",
  trigger: "trigger",
  usage: "usage",
  tool: "tool",
  toolKind: "toolKind",
  program: "program",
  outcome: "outcome",
  failureCategory: "failureCategory",
  findingKind: "findingKind",
  severity: "severity",
  findingCategory: "findingCategory",
} as const;

export type FieldId = (typeof FIELD)[keyof typeof FIELD];

export const LIST_BOX_GROUPS: { title: string; fields: FieldId[] }[] = [
  { title: "When & where", fields: [FIELD.provider, FIELD.date, FIELD.hour, FIELD.session] },
  { title: "Cost", fields: [FIELD.model, FIELD.trigger, FIELD.usage] },
  { title: "Tool calls", fields: [FIELD.tool, FIELD.toolKind, FIELD.program, FIELD.outcome, FIELD.failureCategory] },
  { title: "Signals", fields: [FIELD.findingKind, FIELD.severity, FIELD.findingCategory] },
];

export const SEVERITY_ORDER: FindingSeverity[] = ["critical", "high", "medium", "low", "info"];

export const SEVERITY_LABELS: Record<FindingSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

export const FINDING_KIND_LABELS: Record<FindingKind, string> = {
  security: "Security signal",
  anomaly: "Anomaly",
  "behavior-change": "Behaviour change",
};

const FINDING_CATEGORY_LABELS: Record<string, string> = {
  "remote-code-execution": "Remote code execution",
  obfuscation: "Obfuscated execution",
  "destructive-command": "Destructive command",
  "history-rewrite": "History rewrite",
  "privilege-escalation": "Privilege escalation",
  "credential-access": "Credential access",
  persistence: "Persistence",
  "sensitive-file-write": "System file write",
  "data-exfiltration": "Data upload",
  "network-egress": "Network access",
  "package-install": "Package install",
  "permission-denied": "Denied action",
  "cost-outlier": "Cost outlier",
  "output-outlier": "Output outlier",
  "tool-volume-outlier": "Tool-call volume outlier",
  "failure-rate-outlier": "Failure-rate outlier",
  "new-program": "New program",
  "new-tool": "New tool",
  "new-model": "New model",
};

export function findingCategoryLabel(category: string): string {
  return FINDING_CATEGORY_LABELS[category] ?? category.replace(/-/g, " ");
}

const USAGE_KNOWN = "known";
const USAGE_UNKNOWN = "unknown";

function field<Row>(
  id: FieldId,
  label: string,
  table: string,
  value: (row: Row) => string | undefined,
  extra: Pick<FieldDef, "display" | "compare"> = {},
): FieldDef {
  return { id, label, table, value: (row) => value(row as Row), ...extra };
}

export function createInsightsModel(dataset: InsightsDataset): AssociativeModel {
  const providerLabels = new Map(dataset.providers.map((provider) => [provider.id, provider.label]));
  const sessionTitles = new Map(dataset.sessions.map((session) => [session.key, session.title]));
  return {
    tables: [
      { id: TABLE.sessions, rows: dataset.sessions, key: (row) => (row as InsightSessionRow).key },
      {
        id: TABLE.turns,
        rows: dataset.turns,
        key: (row) => (row as InsightTurnRow).key,
        parent: { table: TABLE.sessions, key: (row) => (row as InsightTurnRow).sessionKey },
      },
      {
        id: TABLE.toolCalls,
        rows: dataset.toolCalls,
        key: (row) => (row as InsightToolCallRow).key,
        parent: { table: TABLE.turns, key: (row) => (row as InsightToolCallRow).turnKey },
      },
      {
        id: TABLE.findings,
        rows: dataset.findings,
        key: (row) => (row as InsightFinding).key,
        parent: { table: TABLE.sessions, key: (row) => (row as InsightFinding).sessionKey },
      },
    ],
    fields: [
      field<InsightSessionRow>(FIELD.provider, "Provider", TABLE.sessions, (row) => row.providerId, {
        display: (value) => providerLabels.get(value) ?? value,
      }),
      field<InsightSessionRow>(FIELD.date, "Date", TABLE.sessions, (row) => row.date, {
        compare: (a, b) => b.localeCompare(a),
      }),
      field<InsightSessionRow>(FIELD.hour, "Hour (UTC)", TABLE.sessions, (row) =>
        row.hour === undefined ? undefined : String(row.hour).padStart(2, "0"),
        { display: (value) => `${value}:00 UTC` },
      ),
      field<InsightSessionRow>(FIELD.session, "Session", TABLE.sessions, (row) => row.key, {
        display: (value) => sessionTitles.get(value) ?? value,
      }),
      field<InsightTurnRow>(FIELD.model, "Model", TABLE.turns, (row) => row.model),
      field<InsightTurnRow>(FIELD.trigger, "Trigger event", TABLE.turns, (row) => row.triggeredEvent, {
        display: (value) => TRIGGER_LABELS[value as TriggeredEvent] ?? value,
      }),
      field<InsightTurnRow>(FIELD.usage, "Usage data", TABLE.turns, (row) => (row.aiCredits === null ? USAGE_UNKNOWN : USAGE_KNOWN), {
        display: (value) => (value === USAGE_KNOWN ? "AI Credits known" : "AI Credits unknown"),
      }),
      field<InsightToolCallRow>(FIELD.tool, "Tool", TABLE.toolCalls, (row) => row.name),
      field<InsightToolCallRow>(FIELD.toolKind, "Tool kind", TABLE.toolCalls, (row) => row.kind),
      field<InsightToolCallRow>(FIELD.program, "Program", TABLE.toolCalls, (row) => row.program),
      field<InsightToolCallRow>(FIELD.outcome, "Outcome", TABLE.toolCalls, (row) => row.status, {
        display: (value) => STATUS_META[value as ToolCallStatus]?.label ?? value,
      }),
      field<InsightToolCallRow>(FIELD.failureCategory, "Failure category", TABLE.toolCalls, (row) => row.failureCategory, {
        display: (value) => CATEGORY_LABELS[value as FailureCategory] ?? value,
      }),
      field<InsightFinding>(FIELD.findingKind, "Signal type", TABLE.findings, (row) => row.kind, {
        display: (value) => FINDING_KIND_LABELS[value as FindingKind] ?? value,
      }),
      field<InsightFinding>(FIELD.severity, "Severity", TABLE.findings, (row) => row.severity, {
        display: (value) => SEVERITY_LABELS[value as FindingSeverity] ?? value,
        compare: (a, b) => SEVERITY_ORDER.indexOf(a as FindingSeverity) - SEVERITY_ORDER.indexOf(b as FindingSeverity),
      }),
      field<InsightFinding>(FIELD.findingCategory, "Signal category", TABLE.findings, (row) => row.category, {
        display: findingCategoryLabel,
      }),
    ],
  };
}
