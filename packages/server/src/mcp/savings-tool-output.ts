// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";
import {
  MAX_SAVINGS_NAME_LENGTH,
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
  savingsWindowSchema,
  type SavingsActionParams,
  type SavingsAmount,
  type SavingsOpportunity,
  type SavingsReport,
} from "@agent-cost-analyzer/domain";
import { foldName, savingsName } from "../services/savings/savings-names.js";
import { excerptOf } from "../services/tool-audit/output-redactor.js";

// Phase 16 SR19 (docs/plans/savings-report.md §8, §11; threat-model "MCP tool
// output"): what get_savings_report gives the model. The report the Savings
// tab shows, ranked the same, cut to `limit` rows, with every log-derived
// string passed through redactSecrets and excerptOf at a fixed cap and the
// action text rendered from its fixed template. Ids, kinds, amounts with
// basis and label, coverage and price version ids pass through as they are:
// an unknown amount keeps its reason and is never 0. No prompt, response,
// file content or path is in a report to begin with; nothing here adds one.

export const MAX_SAVINGS_TOOL_OPPORTUNITIES = 20;
export const DEFAULT_SAVINGS_TOOL_OPPORTUNITIES = 10;
// Session ids per opportunity; sessionsTotal says how many there are.
export const MAX_SAVINGS_TOOL_SESSIONS = 10;
const MAX_KEY_LENGTH = MAX_SAVINGS_NAME_LENGTH * 2;
// The fixed sentences (reasons, assumptions) are shorter than this; it only bounds a stray one.
const MAX_SENTENCE_LENGTH = 600;
const NO_ACTION_TEXT = "No action text is available for this opportunity.";

const opportunityViewSchema = z.object({
  rank: z.number().int().positive(),
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
});

export const savingsToolOutputSchema = z.object({
  window: savingsWindowSchema,
  pricing: pricingModeSchema,
  includeSimulated: z.boolean(),
  opportunities: z.array(opportunityViewSchema).max(MAX_SAVINGS_TOOL_OPPORTUNITIES),
  opportunitiesTotal: z.number().int().nonnegative(),
  simulated: z.array(opportunityViewSchema).max(MAX_SAVINGS_TOOL_OPPORTUNITIES),
  simulatedTotal: z.number().int().nonnegative(),
  notAnalysed: z.array(savingsNotAnalysedSchema),
  sessionsLeftOut: z.array(savingsLeftOutSchema).optional(),
});

export type SavingsToolOutput = z.infer<typeof savingsToolOutputSchema>;
type OpportunityView = z.infer<typeof opportunityViewSchema>;

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

function viewOf(opportunity: SavingsOpportunity, rank: number): OpportunityView {
  const { simulation, sessions } = opportunity;
  return {
    rank,
    key: excerptOf(foldName(opportunity.key), MAX_KEY_LENGTH) || savingsName(opportunity.subject),
    kind: opportunity.kind,
    subject: savingsName(opportunity.subject),
    sessions: sessions.slice(0, MAX_SAVINGS_TOOL_SESSIONS),
    sessionsTotal: sessions.length,
    evidence: opportunity.evidence,
    perWeek: opportunity.perWeek,
    perWindow: opportunity.perWindow,
    coverage: { ...opportunity.coverage, notAnalysed: opportunity.coverage.notAnalysed.map((entry) => ({ ...entry, reason: sentence(entry.reason) })) },
    action: actionOf(opportunity),
    inferred: opportunity.inferred,
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
  const rows = (opportunities: readonly SavingsOpportunity[]) => opportunities.slice(0, limit).map((opportunity, index) => viewOf(opportunity, index + 1));
  return {
    window: report.window,
    pricing: report.pricing,
    includeSimulated,
    opportunities: rows(report.opportunities),
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

function rowText(row: OpportunityView, number: number): string {
  const coverage = `${row.coverage.sessionsAnalysed} of ${row.coverage.sessionsInWindow} sessions analysed`;
  const shown = row.sessions.map((ref) => ref.sessionId).join(", ");
  return [
    `${number}. [${row.kind}] ${row.subject}: ${amountText(row.perWeek, "per week")}; ${amountText(row.perWindow, "over the window")}${row.inferred ? " (cause inferred)" : ""}`,
    `   ${row.action}`,
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
    output.opportunities.forEach((row, index) => lines.push(rowText(row, index + 1)));
  }
  if (output.simulated.length > 0) {
    lines.push("", `Simulated (not ranked${output.simulatedTotal > output.simulated.length ? `, top ${output.simulated.length} of ${output.simulatedTotal}` : ""}): a replay on another model, assuming the same conversation.`);
    output.simulated.forEach((row, index) => lines.push(rowText(row, index + 1)));
  } else if (!output.includeSimulated) {
    lines.push("", "Cheaper-model replays were not run; pass includeSimulated true to add them.");
  }
  if (output.notAnalysed.length > 0) {
    lines.push("", "Not analysed:", ...output.notAnalysed.map((entry) => `- ${entry.kind}, ${entry.providerId}: ${entry.sessions} sessions. ${entry.reason}`));
  }
  if (output.sessionsLeftOut?.length) {
    lines.push("", "Left out of the whole report:", ...output.sessionsLeftOut.map((entry) => `- ${entry.providerId}: ${entry.sessions} sessions. ${entry.reason}`));
  }
  return lines.join("\n");
}
