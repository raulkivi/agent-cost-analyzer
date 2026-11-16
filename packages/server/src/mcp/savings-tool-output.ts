// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";
import {
  MAX_SAVINGS_NAME_LENGTH,
  MAX_SAVINGS_TOOLS,
  pricingModeSchema,
  savingsActionText,
  savingsAmountSchema,
  savingsCoverageSchema,
  savingsEvidenceSchema,
  savingsLeftOutSchema,
  savingsNotAnalysedSchema,
  savingsOpportunityKindSchema,
  savingsSessionRefSchema,
  savingsSimulationSchema,
  savingsToolSchema,
  savingsWindowSchema,
  unlistedTools,
  type SavingsActionParams,
  type SavingsAmount,
  type SavingsEvidence,
  type SavingsOpportunity,
  type SavingsReport,
  type SavingsSessionRef,
  type SavingsTool,
} from "@agent-cost-analyzer/domain";
import { foldName, savingsName } from "../services/savings/savings-names.js";
import { excerptOf } from "../services/tool-audit/output-redactor.js";

// Phase 16 SR19 (docs/plans/savings-report.md §8, §11; threat-model "MCP tool
// output"): what get_savings_report gives the model. The report the Savings
// tab shows, ranked the same, cut to `limit` rows, with every log-derived
// string passed through redactSecrets and excerptOf at a fixed cap and the
// action text rendered from its fixed template. Ids, kinds, amounts with
// basis and label, coverage and price version ids pass through as they are:
// an unknown amount keeps its reason (folded, redacted, capped) and is never
// 0. No prompt, response, file content or path is in a report to begin with;
// nothing here adds one.

export const MAX_SAVINGS_TOOL_OPPORTUNITIES = 20;
export const DEFAULT_SAVINGS_TOOL_OPPORTUNITIES = 10;
// Session ids per opportunity; sessionsTotal says how many there are.
export const MAX_SAVINGS_TOOL_SESSIONS = 10;
// V26 (D26): tools per unused-tools row in the result, and in the text answer.
export const MAX_SAVINGS_TOOL_TOOLS = MAX_SAVINGS_TOOLS;
export const MAX_SAVINGS_TEXT_TOOLS = 5;
const MAX_KEY_LENGTH = MAX_SAVINGS_NAME_LENGTH * 2;
// The fixed sentences (reasons, assumptions) are shorter than this; it only bounds a stray one.
const MAX_SENTENCE_LENGTH = 600;
const NO_ACTION_TEXT = "No action text is available for this opportunity.";

// R12: a Simulated row is never ranked, so only the ranked rows carry `rank`.
const opportunityViewSchema = z.object({
  key: z.string().min(1).max(MAX_KEY_LENGTH),
  kind: savingsOpportunityKindSchema,
  subject: z.string().min(1).max(MAX_SAVINGS_NAME_LENGTH),
  sessions: z.array(savingsSessionRefSchema).max(MAX_SAVINGS_TOOL_SESSIONS),
  sessionsTotal: z.number().int().nonnegative(),
  evidence: savingsEvidenceSchema,
  perWeek: savingsAmountSchema,
  perWindow: savingsAmountSchema,
  coverage: savingsCoverageSchema,
  action: z.string().min(1),
  inferred: z.boolean(),
  simulation: savingsSimulationSchema.optional(),
  // unused-tools only (V26).
  tools: z.array(savingsToolSchema).max(MAX_SAVINGS_TOOL_TOOLS).optional(),
  toolsTotal: z.number().int().nonnegative().optional(),
});

const rankedViewSchema = opportunityViewSchema.extend({ rank: z.number().int().positive() });

export const savingsToolOutputSchema = z.object({
  window: savingsWindowSchema,
  pricing: pricingModeSchema,
  includeSimulated: z.boolean(),
  opportunities: z.array(rankedViewSchema).max(MAX_SAVINGS_TOOL_OPPORTUNITIES),
  opportunitiesTotal: z.number().int().nonnegative(),
  simulated: z.array(opportunityViewSchema).max(MAX_SAVINGS_TOOL_OPPORTUNITIES),
  simulatedTotal: z.number().int().nonnegative(),
  notAnalysed: z.array(savingsNotAnalysedSchema),
  sessionsLeftOut: z.array(savingsLeftOutSchema).optional(),
});

export type SavingsToolOutput = z.infer<typeof savingsToolOutputSchema>;
type OpportunityView = z.infer<typeof opportunityViewSchema>;
type RankedView = z.infer<typeof rankedViewSchema>;

const sentence = (text: string) => excerptOf(foldName(text), MAX_SENTENCE_LENGTH);

function safeParams(params: SavingsActionParams): SavingsActionParams {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, typeof value === "string" ? savingsName(value) : value]));
}

// The template, filled with sanitised parameters; a parameter set it refuses
// (a detector bug) gives a fixed line, not a failed tool call.
function actionOf(opportunity: SavingsOpportunity): string {
  try {
    return savingsActionText(opportunity.kind, safeParams(opportunity.actionParams));
  } catch {
    return NO_ACTION_TEXT;
  }
}

// An unknown amount's or token count's reason can quote a model id from the
// log (SR22), so it is folded, redacted and capped like the coverage reasons.
function amountOf(amount: SavingsAmount): SavingsAmount {
  return amount.known ? amount : { known: false, reason: sentence(amount.reason) };
}

function evidenceOf(evidence: SavingsEvidence): SavingsEvidence {
  const { tokens } = evidence;
  return tokens === null || tokens.known ? evidence : { ...evidence, tokens: { ...tokens, reason: sentence(tokens.reason) } };
}

// D19: the id, the date and the priced saving only; the reason of an unknown
// saving is folded, redacted and capped like the row's.
function sessionOf(ref: SavingsSessionRef): SavingsSessionRef {
  return { ...ref, ...(ref.perWindow === undefined ? {} : { perWindow: amountOf(ref.perWindow) }) };
}

// The name is log-derived, so it is folded, redacted and capped again here; an
// unknown count keeps its reason, folded and capped like the row's.
function toolOf(tool: SavingsTool): SavingsTool {
  return { ...tool, name: savingsName(tool.name), tokens: tool.tokens.known ? tool.tokens : { ...tool.tokens, reason: sentence(tool.tokens.reason) } };
}

function viewOf(opportunity: SavingsOpportunity): OpportunityView {
  const { simulation, sessions } = opportunity;
  return {
    key: excerptOf(foldName(opportunity.key), MAX_KEY_LENGTH) || savingsName(opportunity.subject),
    kind: opportunity.kind,
    subject: savingsName(opportunity.subject),
    sessions: sessions.slice(0, MAX_SAVINGS_TOOL_SESSIONS).map(sessionOf),
    sessionsTotal: sessions.length,
    evidence: evidenceOf(opportunity.evidence),
    perWeek: amountOf(opportunity.perWeek),
    perWindow: amountOf(opportunity.perWindow),
    coverage: { ...opportunity.coverage, notAnalysed: opportunity.coverage.notAnalysed.map((entry) => ({ ...entry, reason: sentence(entry.reason) })) },
    action: actionOf(opportunity),
    inferred: opportunity.inferred,
    ...(opportunity.tools === undefined ? {} : { tools: opportunity.tools.slice(0, MAX_SAVINGS_TOOL_TOOLS).map(toolOf) }),
    ...(opportunity.toolsTotal === undefined ? {} : { toolsTotal: opportunity.toolsTotal }),
    ...(simulation
      ? {
          simulation: {
            ...simulation,
            model: savingsName(simulation.model),
            assumptions: simulation.assumptions.map((assumption) => ({ ...assumption, text: sentence(assumption.text) })),
          },
        }
      : {}),
  };
}

export interface SavingsToolOptions {
  limit: number;
  includeSimulated: boolean;
}

export function savingsToolOutput(report: SavingsReport, { limit, includeSimulated }: SavingsToolOptions): SavingsToolOutput {
  const rows = (opportunities: readonly SavingsOpportunity[]) => opportunities.slice(0, limit).map(viewOf);
  return {
    window: report.window,
    pricing: report.pricing,
    includeSimulated,
    opportunities: rows(report.opportunities).map((row, index): RankedView => ({ rank: index + 1, ...row })),
    opportunitiesTotal: report.opportunities.length,
    simulated: rows(report.simulated),
    simulatedTotal: report.simulated.length,
    notAnalysed: report.notAnalysed.map((entry) => ({ ...entry, reason: sentence(entry.reason) })),
    ...(report.sessionsLeftOut ? { sessionsLeftOut: report.sessionsLeftOut.map((entry) => ({ ...entry, reason: sentence(entry.reason) })) } : {}),
  };
}

const CURRENCY_NAMES = { USD: "USD", AI_CREDITS: "AI Credits" } as const;

// Three significant digits: a $0.0031 saving stays readable, a 12,345 one doesn't show false precision.
const figure = (value: number) => String(Number(value.toPrecision(3)));

function amountText(amount: SavingsAmount, unit: string): string {
  if (!amount.known) return `unknown (${amount.reason})`;
  const currency = CURRENCY_NAMES[amount.currency as keyof typeof CURRENCY_NAMES] ?? amount.currency;
  if (amount.label === "upper-bound") return `up to ${figure(amount.high)} ${currency} ${unit}`;
  const range = amount.low === amount.high ? figure(amount.high) : `${figure(amount.low)}-${figure(amount.high)}`;
  return `${amount.label === "simulated" ? "about " : ""}${range} ${currency} ${unit}${amount.label === "simulated" ? " (Simulated)" : ""}`;
}

// `<id> (<YYYY-MM-DD>, up to 1.2 USD)`: no title (D19). A start the log lacks is
// "date unknown" and a session that could not be priced is "not priced", never 0.
function sessionText(ref: SavingsSessionRef): string {
  const date = ref.startedAt === undefined ? "date unknown" : ref.startedAt.slice(0, 10);
  const saving = ref.perWindow?.known === true ? amountText(ref.perWindow, "").trim() : "not priced";
  return `${ref.sessionId} (${date}, ${saving})`;
}

const grouped = (value: number) => value.toLocaleString("en-US");
// "1 session", "3 sessions" (R14, V29).
const sessionsNoun = (count: number) => (count === 1 ? "session" : "sessions");

// `Tools (token estimates per request): a (about 600), ..., and 18 more (about 2,500).`
// The first MAX_SAVINGS_TEXT_TOOLS only; the structured result has up to 20. An
// unknown count reads "not known", and the rest's tokens are left out when they can't be said.
function toolsLine(row: OpportunityView): string | null {
  if (row.tools === undefined || row.tools.length === 0) return null;
  const shown = row.tools.slice(0, MAX_SAVINGS_TEXT_TOOLS);
  const listed = shown.map((tool) => `${tool.name} (${tool.tokens.known ? `about ${grouped(tool.tokens.value)}` : "not known"})`);
  const rest = unlistedTools(shown, row.toolsTotal ?? row.tools.length, row.evidence.tokens);
  if (rest.count > 0) listed.push(`and ${rest.count} more${rest.tokens === null ? "" : ` (about ${grouped(rest.tokens)})`}`);
  return `   Tools (token estimates per request): ${listed.join(", ")}.`;
}

// Ranked rows are numbered; Simulated rows are bullets (R12): they are never ranked.
function rowText(row: OpportunityView, marker: string): string {
  const coverage = `${row.coverage.sessionsAnalysed} of ${row.coverage.sessionsInWindow} ${sessionsNoun(row.coverage.sessionsInWindow)} analysed`; // codespell:ignore analysed
  const shown = row.sessions.map(sessionText).join(", ");
  const tools = toolsLine(row);
  return [
    `${marker} [${row.kind}] ${row.subject}: ${amountText(row.perWeek, "per week")}; ${amountText(row.perWindow, "over the window")}${row.inferred ? " (cause inferred)" : ""}`,
    `   ${row.action}`,
    ...(tools === null ? [] : [tools]),
    `   ${coverage}. Sessions: ${shown || "none"}${row.sessionsTotal > row.sessions.length ? ` and ${row.sessionsTotal - row.sessions.length} more` : ""}.`,
  ].join("\n");
}

// The ranked list a host without views shows; the structured result carries the same rows.
export function savingsReportText(output: SavingsToolOutput): string {
  const { window } = output;
  const lines = [
    `Savings report ${window.since} to ${window.until} (${window.days} days), prices ${output.pricing === "today" ? "today" : "as of use"}. These are estimates, not billed amounts: each is a range or an upper bound priced from the price book, and an unknown amount is unknown, not 0.`,
  ];
  if (output.opportunities.length === 0) {
    lines.push("No savings found in this window.");
  } else {
    lines.push("", `Ranked by the high end${output.opportunitiesTotal > output.opportunities.length ? ` (top ${output.opportunities.length} of ${output.opportunitiesTotal})` : ""}:`);
    output.opportunities.forEach((row) => lines.push(rowText(row, `${row.rank}.`)));
  }
  if (output.simulated.length > 0) {
    lines.push("", `Simulated (not ranked${output.simulatedTotal > output.simulated.length ? `, top ${output.simulated.length} of ${output.simulatedTotal}` : ""}): a replay on another model, assuming the same conversation.`);
    output.simulated.forEach((row) => lines.push(rowText(row, "-")));
  } else if (!output.includeSimulated) {
    lines.push("", "Cheaper-model replays were not run; pass includeSimulated true to add them.");
  }
  if (output.notAnalysed.length > 0) {
    lines.push("", "Not analysed:", ...output.notAnalysed.map((entry) => `- ${entry.kind}, ${entry.providerId}: ${entry.sessions} ${sessionsNoun(entry.sessions)}. ${entry.reason}`)); // codespell:ignore analysed
  }
  if (output.sessionsLeftOut?.length) {
    lines.push("", "Left out of the whole report:", ...output.sessionsLeftOut.map((entry) => `- ${entry.providerId}: ${entry.sessions} ${sessionsNoun(entry.sessions)}. ${entry.reason}`));
  }
  return lines.join("\n");
}
