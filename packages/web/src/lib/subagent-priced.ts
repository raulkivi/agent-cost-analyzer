// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostFigure, SubagentRunUsage, SubagentSpend, SubagentTokens, TokenCount, Turn, TurnCostFigures, TurnUsage } from "@agent-cost-analyzer/domain";
import { formatUsd } from "./ai-credits-usd.js";

// Step CS13 (docs/plans/claude-code-subagents.md §5.6, CS2 boards): what a
// turn without AI Credits (Claude Code) shows of its subagent runs: tokens
// and a priced cost. The API puts `pricedCost` on the turn, the main agent's
// own line and each run. Unknown is never 0: a part with an unknown field
// reads unknown, and no total adds only the known parts. Pure; the web
// panel and the MCP App's turn detail both read it.

type TokenField = "uncachedInput" | "cacheWrite" | "cacheRead" | "output";
const TOKEN_FIELDS: readonly { field: TokenField; label: string }[] = [
  { field: "uncachedInput", label: "Uncached input" },
  { field: "cacheWrite", label: "Cache write" },
  { field: "cacheRead", label: "Cache read" },
  { field: "output", label: "Output" },
];

const DASH = "—";

type TokenFields = Record<TokenField, TokenCount>;
interface UnknownField {
  label: string;
  reason: string;
}
interface Tokens {
  // null when any field of any part is unknown.
  value: number | null;
  unknown: UnknownField[];
}

const runsNoun = (count: number) => `${count} ${count === 1 ? "subagent run" : "subagent runs"}`;

// 950 -> "950", 88,000 -> "88k", 4,100 -> "4.1k", 2,040,000 -> "2.04M", 31,500,000 -> "31.5M".
export function formatTokenTotal(value: number): string {
  if (value < 1000) return String(Math.round(value));
  if (value < 100_000) {
    const thousands = value / 1000;
    return `${thousands < 10 ? thousands.toFixed(1).replace(/\.0$/, "") : Math.round(thousands)}k`;
  }
  const millions = value / 1_000_000;
  return `${millions >= 10 ? millions.toFixed(1) : millions.toFixed(2)}M`;
}

export function isPricedUsage(usage: TurnUsage): boolean {
  return usage.pricedCost !== undefined;
}

function sumTokens(parts: readonly TokenFields[]): Tokens {
  const unknown: UnknownField[] = [];
  let value = 0;
  for (const { field, label } of TOKEN_FIELDS) {
    for (const part of parts) {
      const count = part[field];
      if (count.known) value += count.value;
      else if (!unknown.some((entry) => entry.label === label)) unknown.push({ label, reason: count.reason });
    }
  }
  return { value: unknown.length === 0 ? value : null, unknown };
}

function costOf(figure: CostFigure | undefined): { amount: number | null; reason: string } {
  if (figure === undefined) return { amount: null, reason: "No priced cost was recorded." };
  return figure.known ? { amount: figure.amount, reason: "" } : { amount: null, reason: figure.reason };
}

function sumCosts(figures: readonly (CostFigure | undefined)[]): { amount: number | null; reason: string } {
  const parts = figures.map(costOf);
  const unknown = parts.find((part) => part.amount === null);
  if (unknown) return unknown;
  return { amount: parts.reduce((sum, part) => sum + (part.amount ?? 0), 0), reason: "" };
}

// "The subagent transcript ... is missing." -> "the subagent transcript ... is missing"
function clause(reason: string): string {
  const trimmed = reason.replace(/\.$/, "");
  return /^[A-Z](?![A-Z])/.test(trimmed) ? trimmed.charAt(0).toLowerCase() + trimmed.slice(1) : trimmed;
}

export interface PricedFigure {
  text: string;
  known: boolean;
}

const tokenFigure = (tokens: Tokens): PricedFigure => (tokens.value === null ? { text: DASH, known: false } : { text: formatTokenTotal(tokens.value), known: true });
const costFigure = (cost: { amount: number | null }): PricedFigure => (cost.amount === null ? { text: DASH, known: false } : { text: formatUsd(cost.amount), known: true });

export interface PricedRunRow {
  id: string;
  name: string;
  model: string;
  requests: string;
  tokens: PricedFigure;
  cost: PricedFigure;
  unknown: boolean;
  reason?: string;
  matchedByTime: boolean;
  startedBy?: string;
}

export interface PricedPart {
  text: string;
  known: boolean;
}

export interface PricedBreakdown {
  runs: PricedRunRow[];
  main: PricedPart;
  subagents: PricedPart;
  turn: PricedPart;
  // The sub-line under the turn's priced cost: "incl. $0.38 from 2 subagent runs", or why it is unknown.
  costNote: { text: string; known: boolean };
  share?: string;
  unknownNote?: string;
  pricedAsOf?: string;
  // "Priced at Anthropic prices as of <date>, each run on its own model. Claude Code has no AI Credits."
  priceNote: string;
}

function partOf(tokens: Tokens, cost: { amount: number | null }): PricedPart {
  if (tokens.value === null) return { text: "unknown", known: false };
  if (cost.amount === null) return { text: `${formatTokenTotal(tokens.value)} · cost unknown`, known: false };
  return { text: `${formatTokenTotal(tokens.value)} · ${formatUsd(cost.amount)}`, known: true };
}

const nameOf = (run: Pick<SubagentRunUsage, "agentName" | "label">) => run.agentName ?? run.label.replace(/^Agent-/, "");

function runRow(run: SubagentRunUsage, runs: readonly SubagentRunUsage[]): PricedRunRow {
  const tokens = sumTokens([run]);
  const cost = costOf(run.pricedCost);
  const unreadWhole = tokens.unknown.length === TOKEN_FIELDS.length;
  const unknown = tokens.value === null || cost.amount === null;
  const parent = run.parentRunId === undefined ? undefined : runs.find((candidate) => candidate.id === run.parentRunId);
  const row: PricedRunRow = {
    id: run.id,
    name: nameOf(run),
    model: run.model === "" || run.model === "unknown" ? "model unknown" : run.model,
    requests: unreadWhole ? "requests unknown" : `${run.roundsCount} ${run.roundsCount === 1 ? "request" : "requests"}`,
    tokens: tokenFigure(tokens),
    cost: costFigure(cost),
    unknown,
    matchedByTime: run.attribution === "timestamp",
  };
  if (unknown) row.reason = tokens.unknown[0]?.reason ?? cost.reason;
  if (parent) row.startedBy = nameOf(parent);
  return row;
}

const PRICE_DATE = /:(\d{4}-\d{2}-\d{2})$/;

function pricedAsOf(figures: readonly (CostFigure | undefined)[]): string | undefined {
  const dates = figures.flatMap((figure) => (figure?.known ? (figure.priceVersionIds ?? []).flatMap((id) => PRICE_DATE.exec(id)?.[1] ?? []) : []));
  return dates.length === 0 ? undefined : dates.sort().at(-1);
}

const percent = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;

function shareSentence(runs: Tokens, turn: Tokens, runsCost: { amount: number | null }, turnCost: { amount: number | null }): string | undefined {
  const tokenShare = runs.value !== null && turn.value !== null && turn.value > 0 ? percent(runs.value, turn.value) : undefined;
  const costShare = runsCost.amount !== null && turnCost.amount !== null && turnCost.amount > 0 ? percent(runsCost.amount, turnCost.amount) : undefined;
  if (tokenShare && costShare) return `Subagent runs are ${tokenShare} of this turn's tokens and ${costShare} of its priced cost.`;
  if (tokenShare) return `Subagent runs are ${tokenShare} of this turn's tokens.`;
  if (costShare) return `Subagent runs are ${costShare} of this turn's priced cost.`;
  return undefined;
}

function unknownSentence(rows: readonly PricedRunRow[], tokensUnknown: boolean, costUnknown: boolean, reason: string): string | undefined {
  if (!tokensUnknown && !costUnknown) return undefined;
  const what = tokensUnknown && costUnknown ? "tokens and cost are" : tokensUnknown ? "tokens are" : "cost is";
  const names = rows.filter((row) => row.unknown).map((row) => row.name);
  if (names.length === 0) return `This turn's ${what} unknown: ${clause(reason)}.`;
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `This turn's ${what} unknown until the ${list} ${names.length === 1 ? "run" : "runs"} can be read.`;
}

export function pricedBreakdown(usage: TurnUsage): PricedBreakdown | undefined {
  const { subagents, ownUsage } = usage;
  if (subagents === undefined || ownUsage === undefined || (subagents.length === 0 && usage.pricedCost?.known !== false)) return undefined;
  const runTokens = sumTokens(subagents);
  const runCost = sumCosts(subagents.map((run) => run.pricedCost));
  const mainTokens = sumTokens([ownUsage]);
  const mainCost = costOf(ownUsage.pricedCost);
  const turnTokens = sumTokens([usage]);
  const turnCost = costOf(usage.pricedCost);
  const runs = subagents.map((run) => runRow(run, subagents));
  const unknownRun = runs.find((run) => run.unknown);
  const costNote =
    runCost.amount === null
      ? { text: `unknown: ${unknownRun?.reason ?? runCost.reason}`, known: false }
      : { text: `incl. ${formatUsd(runCost.amount)} from ${runsNoun(subagents.length)}`, known: true };
  const asOf = pricedAsOf([usage.pricedCost, ownUsage.pricedCost, ...subagents.map((run) => run.pricedCost)]);
  const breakdown: PricedBreakdown = {
    priceNote: `${asOf === undefined ? "Priced at Anthropic prices" : `Priced at Anthropic prices as of ${asOf}`}, each run on its own model. Claude Code has no AI Credits.`,
    costNote,
    runs,
    main: partOf(mainTokens, mainCost),
    subagents: subagents.length === 0 ? { text: "none", known: true } : partOf(runTokens, runCost),
    turn: partOf(turnTokens, turnCost),
  };
  const share = shareSentence(runTokens, turnTokens, runCost, turnCost);
  if (share) breakdown.share = share;
  const unknownNote = unknownSentence(runs, turnTokens.value === null, turnCost.amount === null, turnTokens.unknown[0]?.reason ?? turnCost.reason);
  if (unknownNote) breakdown.unknownNote = unknownNote;
  if (asOf) breakdown.pricedAsOf = asOf;
  return breakdown;
}

// The turns-table marker's tooltip and accessible name (board TurnsTable).
export function pricedMarker(usage: TurnUsage): { text: string; unknown: boolean } | undefined {
  const { subagents } = usage;
  if (subagents === undefined) return undefined;
  const tokens = sumTokens(subagents);
  const cost = sumCosts(subagents.map((run) => run.pricedCost));
  if (subagents.length === 0 && tokens.value !== null && cost.amount !== null) return undefined;
  if (tokens.value === null) {
    const first = tokens.unknown[0]!;
    if (tokens.unknown.length === TOKEN_FIELDS.length) return { unknown: true, text: `Tokens and cost unknown: ${clause(first.reason)}.` };
    return { unknown: true, text: `${first.label} unknown: ${clause(first.reason)}. The other columns include the run.` };
  }
  if (cost.amount === null) return { unknown: true, text: `Cost unknown: ${clause(cost.reason)}.` };
  const byTime = subagents.some((run) => run.attribution === "timestamp") ? ", matched by time" : "";
  return { unknown: false, text: `incl. ${formatTokenTotal(tokens.value)} tokens, ${formatUsd(cost.amount)} priced, from ${runsNoun(subagents.length)}${byTime}` };
}

// The session KPI tile's sub-line (D12): "matched by time" stays out of it.
export function pricedSessionLine(spend: SubagentSpend | undefined): string | undefined {
  if (!spend?.tokens) return undefined;
  const tokens = sumTokens([spend.tokens]);
  if (tokens.value === null) return `unknown: ${tokens.unknown[0]!.reason}`;
  const cost = costOf(spend.cost?.priced);
  const from = `${formatTokenTotal(tokens.value)} tokens from ${runsNoun(spend.runs)}`;
  if (cost.amount === null) return `incl. ${from}; cost unknown: ${cost.reason}`;
  return `incl. ${formatUsd(cost.amount)} and ${from}`;
}

// The Priced cost tile: all turns' priced cost, unknown when one turn is.
export function pricedSessionTotal(turns: readonly Turn[]): { value: string; reason?: string } | undefined {
  if (!turns.some((turn) => isPricedUsage(turn.usage))) return undefined;
  const total = sumCosts(turns.map((turn) => turn.usage.pricedCost));
  return total.amount === null ? { value: "unknown", reason: total.reason } : { value: formatUsd(total.amount) };
}

// One turn's totals for a card: tokens and priced cost, each with its reason when unknown.
export function pricedTurnFigures(usage: TurnUsage): { tokens: PricedFigure; cost: PricedFigure; reason?: string } | undefined {
  if (!isPricedUsage(usage)) return undefined;
  const tokens = sumTokens([usage]);
  const cost = costOf(usage.pricedCost);
  const reason = tokens.unknown[0]?.reason ?? (cost.amount === null ? cost.reason : undefined);
  return { tokens: tokenFigure(tokens), cost: costFigure(cost), ...(reason === undefined ? {} : { reason }) };
}

// The runs a replay leaves out (Claude Code, no AI Credits): their priced cost
// and tokens as a sentence for the replay summary. Undefined without a priced
// figure, so the caller keeps its AI Credits wording. Unknown is never 0.
export function pricedRunsSentence(tokens: SubagentTokens | undefined, cost: TurnCostFigures | undefined): string | undefined {
  if (cost === undefined) return undefined;
  const priced = costOf(cost.priced);
  if (priced.amount === null) return `Their priced cost is unknown: ${priced.reason}`;
  const lead = `Their priced cost is ${formatUsd(priced.amount)}`;
  if (tokens === undefined) return `${lead}.`;
  const summed = sumTokens([tokens]);
  if (summed.value === null) return `${lead}; their tokens are unknown: ${summed.unknown[0]!.reason}`;
  return `${lead} for ${formatTokenTotal(summed.value)} tokens.`;
}
