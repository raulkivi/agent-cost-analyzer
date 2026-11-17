// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mergeNotAnalysedReasons, type Currency, SavingsAmount, SavingsCoverage, SavingsEvidence, SavingsNotAnalysed, SavingsLeftOut, SavingsOpportunity, SavingsSessionRef, SavingsSimulation, SavingsWindow } from "@agent-cost-analyzer/domain";
import { amountText, barSegments, CURRENCY_TITLES, KIND_TITLES, notPricedReasons, sessionDateText, sessionSavingText, toolListOf, type ToolListView } from "@agent-cost-analyzer/web/lib/savings/savings-view";
import { isPlainModelId } from "../views/replay/model-id.js";
import { pluralize } from "./format.js";
import { mergeUserPriceIds } from "./user-price.js";

// U18, savings report (docs/plans/savings-report.md §8, decisions D16-D21,
// boards Savings.dc.html and SavingsStates.dc.html). Pure: formats the
// structuredContent of get_savings_report. Every word a user reads that is
// not logged text is built here, so a test can assert it. Logged text (the
// subject, the key, the action text, reasons) passes through unchanged and is
// shown as plain text only; the drill-downs take ids and a plain model id.

// What get_savings_report returns per row (server/src/mcp/savings-tool-output.ts):
// the opportunity with its action already rendered and its session list capped.
export type SavingsRowInput = Omit<SavingsOpportunity, "actionParams" | "sessions"> & {
  // Ranked rows only: a Simulated row is never ranked (R12).
  rank?: number;
  sessions: SavingsSessionRef[];
  sessionsTotal: number;
  action: string;
};

export interface SavingsViewInput {
  window: SavingsWindow;
  pricing: "as-of-use" | "today";
  includeSimulated: boolean;
  opportunities: SavingsRowInput[];
  opportunitiesTotal: number;
  simulated: SavingsRowInput[];
  simulatedTotal: number;
  notAnalysed: SavingsNotAnalysed[];
  sessionsLeftOut?: SavingsLeftOut[] | undefined;
}

export interface SessionButtonView {
  providerId: string;
  sessionId: string;
  kind: "cost" | "replay";
  label: "Open cost" | "Open replay";
  // V24 (D19): the session's date ("Nov 11", "date unknown") and its saving over the window; no title.
  dateText: string;
  savingText: string;
  // Replay only: the simulated model, checked to be a plain model id.
  model?: string;
}

export interface SavingsRowView {
  key: string;
  rank?: number; // priced, ranked rows only
  kindTitle: string;
  subject: string; // logged text: display only
  inferred: boolean;
  estimate: boolean;
  simulated: boolean;
  coverageText: string;
  amountText: string;
  unknownReason?: string; // logged text: display only
  bar?: { solid: number; hatched: number };
  windowText: string;
  evidence: { label: string; value: string }[];
  // V26: unused-tools rows only; tool names are logged text: display only.
  toolList?: ToolListView;
  action: string; // logged text: display only
  sessions: SessionButtonView[];
  sessionsHeading: string;
  // The reasons shown sessions could not be priced, said once under the list.
  notPricedText?: string;
  priceVersions: string[];
  // 1.0 V2b (threat-model 5.10): the user-added price versions behind the amounts.
  userPriceVersionIds?: string[];
  simulation?: { selfCheck: string; replayed: string; assumptions: { id: string; text: string }[] };
}

export interface SavingsGroupView {
  currency: Currency;
  title: string;
  subtitle: string;
  rows: SavingsRowView[];
}

export interface SavingsViewModel {
  periodText: string;
  basisText: string;
  notes: string[];
  truncationText?: string;
  empty?: string;
  groups: SavingsGroupView[];
  simulated: { rows: SavingsRowView[]; text?: string };
  notAnalysed: { kindTitle: string; providerLabel: string; reason: string; sessionsText: string }[];
  leftOut: { providerLabel: string; reason: string; sessionsText: string }[];
}

const MAX_SESSIONS_SHOWN = 3;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const PROVIDER_LABELS: Readonly<Record<string, string>> = { vscode: "GitHub Copilot", "agent-host": "Agent Host", "claude-code": "Claude Code", "pi-agent": "pi" };
// Copilot bills in AI Credits; the other providers' savings are priced in dollars.
const AI_CREDIT_PROVIDERS: ReadonlySet<string> = new Set(["vscode", "agent-host"]);
const CURRENCY_ORDER: readonly Currency[] = ["AI_CREDITS", "USD"];

const NOTES = [
  "Changes are ranked by the high end; the low end sits beside it. Opportunities overlap, so they are not added up.",
  "Amounts are priced from the price book and cannot be billed.",
];
const SIMULATED_OFF_TEXT = 'Simulated replays are off. A replay of each of the most expensive sessions is the slow part, so it runs only when asked. To include it, ask in the chat, for example "show my savings including simulated replays".';
const SIMULATED_EMPTY_TEXT = "No cheaper-model replay found in this window.";

const providerLabel = (providerId: string): string => PROVIDER_LABELS[providerId] ?? providerId;
const count = pluralize;
const grouped = (value: number) => value.toLocaleString("en-US");

function dayText(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${MONTHS[Number(month) - 1] ?? month} ${Number(day)}`;
}

function coverageText(row: SavingsRowInput): string {
  const { coverage, simulation } = row;
  if (simulation !== undefined) {
    return `${coverage.sessionsAnalysed} of ${coverage.sessionsInWindow} sessions replayed · replayed ${simulation.coverage.replayedRequests} of ${simulation.coverage.requests} requests`;
  }
  return gapText(coverage);
}

function gapText(coverage: SavingsCoverage): string {
  const gaps = mergeNotAnalysedReasons(coverage.notAnalysed).map((gap) => `${gap.sessions} not analysed: ${gap.reason}`); // codespell:ignore analysed
  return [`${coverage.sessionsAnalysed} of ${coverage.sessionsInWindow} sessions`, ...gaps].join(" · ");
}

function windowText(amount: SavingsAmount, days: number): string {
  if (!amount.known) return "";
  const text = amountText(amount, "").trim();
  return amount.label === "upper-bound" ? `Over the ${days} days: ${text}. No lower bound is claimed.` : `Over the ${days} days: ${text}.`;
}

const OCCURRENCE_LABELS: Partial<Record<SavingsOpportunity["kind"], string>> = {
  "idle-cache-expiry": "Breaks",
  "unexplained-cache-break": "Breaks",
  "model-switch": "Switches",
  "failed-tool-calls": "Failed calls",
  "cheaper-model": "Turns replayed",
};

function evidenceRows(kind: SavingsOpportunity["kind"], evidence: SavingsEvidence): { label: string; value: string }[] {
  const rows = [
    { label: "Sessions", value: grouped(evidence.sessions) },
    { label: "Requests", value: evidence.requests === null ? "Unknown" : grouped(evidence.requests) },
  ];
  const tokens = evidence.tokens;
  if (kind !== "cheaper-model") {
    const label = kind === "unused-tools" ? "Tokens per request" : kind === "idle-cache-expiry" ? "Tokens resent" : "Tokens";
    rows.push({ label, value: tokens === null ? "Unknown" : tokens.known ? `${grouped(tokens.value)}${tokens.estimated === true ? " (estimate)" : ""}` : `Unknown (${tokens.reason})` });
  }
  const occurrences = OCCURRENCE_LABELS[kind];
  if (occurrences !== undefined) rows.push({ label: occurrences, value: evidence.occurrences === null ? "Unknown" : grouped(evidence.occurrences) });
  return rows;
}

function simulationView(simulation: SavingsSimulation): NonNullable<SavingsRowView["simulation"]> {
  const { selfCheck, coverage } = simulation;
  const percent = Math.round((selfCheck.matching / selfCheck.requests) * 100);
  return {
    selfCheck: `${selfCheck.passed ? "passed" : "did not pass"}, ${percent}% of requests`,
    replayed: `${coverage.replayedRequests} of ${coverage.requests} requests`,
    assumptions: simulation.assumptions.map(({ id, text }) => ({ id, text })),
  };
}

function sessionButtons(row: SavingsRowInput): SessionButtonView[] {
  const model = row.simulation?.model;
  const replayable = model !== undefined && isPlainModelId(model);
  return row.sessions.slice(0, MAX_SESSIONS_SHOWN).map((ref) => {
    const { providerId, sessionId } = ref;
    const when = { dateText: sessionDateText(ref.startedAt), savingText: sessionSavingText(ref) };
    return replayable ? { providerId, sessionId, kind: "replay", label: "Open replay", model, ...when } : { providerId, sessionId, kind: "cost", label: "Open cost", ...when };
  });
}

function rowView(row: SavingsRowInput, days: number, rank: number | undefined, maxHigh: number): SavingsRowView {
  const { perWeek } = row;
  const userPriceVersionIds = mergeUserPriceIds(perWeek.known ? perWeek.userPriceVersionIds : undefined, row.perWindow.known ? row.perWindow.userPriceVersionIds : undefined);
  const bar = barSegments(perWeek, maxHigh);
  const shown = Math.min(row.sessions.length, MAX_SESSIONS_SHOWN);
  const notPriced = notPricedReasons(row.sessions.slice(0, MAX_SESSIONS_SHOWN));
  const toolList = toolListOf(row);
  return {
    key: row.key,
    ...(rank === undefined ? {} : { rank }),
    kindTitle: KIND_TITLES[row.kind],
    subject: row.subject,
    inferred: row.inferred,
    estimate: row.evidence.tokens?.known === true && row.evidence.tokens.estimated === true,
    simulated: row.kind === "cheaper-model",
    coverageText: coverageText(row),
    amountText: amountText(perWeek),
    ...(perWeek.known ? {} : { unknownReason: perWeek.reason }),
    ...(bar === null ? {} : { bar }),
    windowText: windowText(row.perWindow, days),
    evidence: evidenceRows(row.kind, row.evidence),
    ...(toolList === null ? {} : { toolList }),
    action: row.action,
    sessions: sessionButtons(row),
    // The server lists sessions largest first (D16), so a cut list is the largest.
    ...(notPriced.length === 0 ? {} : { notPricedText: `Not priced: ${notPriced.join("; ")}` }),
    sessionsHeading: shown < row.sessionsTotal ? `Largest ${shown} of ${row.sessionsTotal} sessions, over the ${days} days` : `${count(row.sessionsTotal, "session")}, over the ${days} days`,
    priceVersions: perWeek.known ? perWeek.priceVersionIds : row.perWindow.known ? row.perWindow.priceVersionIds : [],
    ...(row.simulation === undefined ? {} : { simulation: simulationView(row.simulation) }),
    ...(userPriceVersionIds === undefined ? {} : { userPriceVersionIds }),
  };
}

const highOf = (row: SavingsRowInput) => (row.perWeek.known ? row.perWeek.high : 0);

// One list per currency, in the server's order (it ranks by the high end,
// unknown last). Amounts are never converted. A row with no price has no
// currency of its own, so it joins the list of its provider's priced rows,
// else the provider's usual currency.
function groupViews(rows: readonly SavingsRowInput[], days: number): SavingsGroupView[] {
  const providerCurrency = new Map<string, Currency>();
  for (const row of rows) {
    if (row.perWeek.known) for (const session of row.sessions) providerCurrency.set(session.providerId, row.perWeek.currency);
  }
  const currencyOf = (row: SavingsRowInput): Currency => {
    if (row.perWeek.known) return row.perWeek.currency;
    const providerId = row.sessions[0]?.providerId ?? "";
    return providerCurrency.get(providerId) ?? (AI_CREDIT_PROVIDERS.has(providerId) ? "AI_CREDITS" : "USD");
  };
  return CURRENCY_ORDER.flatMap((currency) => {
    const members = rows.filter((row) => currencyOf(row) === currency);
    if (members.length === 0) return [];
    const priced = members.filter((row) => row.perWeek.known);
    const unpriced = members.filter((row) => !row.perWeek.known);
    const maxHigh = Math.max(0, ...priced.map(highOf));
    const providers = [...new Set(members.flatMap((row) => row.sessions.map((session) => providerLabel(session.providerId))))];
    const counts = [count(priced.length, "change"), ...(unpriced.length > 0 ? [`${unpriced.length} not priced`] : [])].join(", ");
    return [
      {
        currency,
        title: CURRENCY_TITLES[currency],
        subtitle: `${providers.join(", ")}${providers.length > 0 ? " · " : ""}${counts}`,
        rows: [...priced.map((row, index) => rowView(row, days, index + 1, maxHigh)), ...unpriced.map((row) => rowView(row, days, undefined, maxHigh))],
      },
    ];
  });
}

export function toSavingsViewModel(input: SavingsViewInput): SavingsViewModel {
  const { window } = input;
  const days = window.days;
  const simulatedMax = Math.max(0, ...input.simulated.map(highOf));
  const truncated = input.opportunitiesTotal > input.opportunities.length;
  return {
    periodText: `${dayText(window.since)} – ${dayText(window.until)}, ${days} days`,
    basisText: `amounts per week · prices ${input.pricing === "today" ? "today" : "as of use"}`,
    notes: NOTES,
    ...(truncated ? { truncationText: `Showing the ${input.opportunities.length} highest of ${input.opportunitiesTotal} changes. Ask in the chat for more, up to 20.` } : {}),
    ...(input.opportunities.length === 0 ? { empty: "No savings found in this window." } : {}),
    groups: groupViews(input.opportunities, days),
    simulated: {
      rows: input.simulated.map((row) => rowView(row, days, undefined, simulatedMax)),
      ...(input.simulated.length > 0 ? {} : { text: input.includeSimulated ? SIMULATED_EMPTY_TEXT : SIMULATED_OFF_TEXT }),
    },
    notAnalysed: input.notAnalysed.map((entry) => ({ kindTitle: KIND_TITLES[entry.kind], providerLabel: providerLabel(entry.providerId), reason: entry.reason, sessionsText: count(entry.sessions, "session") })),
    leftOut: (input.sessionsLeftOut ?? []).map((entry) => ({ providerLabel: providerLabel(entry.providerId), reason: entry.reason, sessionsText: count(entry.sessions, "session") })),
  };
}
