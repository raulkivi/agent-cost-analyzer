import { channelLabel } from "./channels.js";
import type { Currency } from "./cost-figure.js";
import type { Statement } from "./statement.js";

// Phase 15 step 15.11 (plan §8.5): a statement as CSV (its lines), JSON
// (all of it) or Markdown (for a client email). Shared by the server and
// the web export dialog's preview, so both write the same bytes. Session ids
// and titles only, never message text; titles can be left out.

export type StatementExportFormat = "csv" | "json" | "markdown";

export interface StatementExportOptions {
  includeTitles?: boolean; // default true
}

const fixed2 = (value: number) => value.toFixed(2);
const unitName = (currency: Currency | string) => (currency === "AI_CREDITS" ? "AI Credits" : currency);
const knownOrBlank = (value: number | null) => (value === null ? "" : String(value));

// RFC 4180 quoting; a leading = + - @ gets a quote so a spreadsheet won't
// run it as a formula (CSV injection).
function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const csvRow = (fields: readonly string[]) => fields.map(csvField).join(",");

function withoutTitles(statement: Statement): Statement {
  return { ...statement, provenance: { ...statement.provenance, sessions: statement.provenance.sessions.map(({ providerId, sessionId }) => ({ providerId, sessionId })) } };
}

function toCsv(statement: Statement): string {
  const empty = (count: number) => Array.from({ length: count }, () => "");
  const rows = [
    ["kind", "basis", "currency", "channel", "model", "price_version", "sessions", "turns", "uncached_input", "cache_read", "cache_write", "reasoning", "output", "amount", "note"],
    ...statement.lines.map((line) => [
      "line",
      line.basis,
      line.currency,
      line.channel ?? "",
      line.model,
      line.priceVersionId ?? "",
      String(line.sessions),
      String(line.turns),
      knownOrBlank(line.tokens.uncachedInput),
      knownOrBlank(line.tokens.cacheRead),
      knownOrBlank(line.tokens.cacheWrite),
      knownOrBlank(line.tokens.reasoning),
      knownOrBlank(line.tokens.output),
      fixed2(line.amount),
      line.apiEquivalent ? "API-equivalent (subscription use)" : "",
    ]),
    ...statement.unknown.map((line) => ["unknown", ...empty(5), String(line.sessions), String(line.turns), ...empty(6), line.reason]),
    ...statement.excluded.map((line) => ["excluded", ...empty(5), String(line.sessions), String(line.turns), ...empty(6), line.reason]),
    ...statement.markup
      .filter((markup) => markup.amount > 0)
      .map((markup) => ["markup", "", markup.currency, ...empty(10), fixed2(markup.amount), `${statement.markupPercent ?? 0}% of ${fixed2(markup.base)}`]),
    ...statement.fixedLines.map((line) => ["fixed", "", line.currency, ...empty(10), fixed2(line.amount), line.label]),
    ...statement.totals.map((total) => ["total", "", total.currency, ...empty(10), fixed2(total.total), ""]),
    ...(statement.userCurrency ? [["total", "", statement.userCurrency.code, ...empty(10), fixed2(statement.userCurrency.total), statement.userCurrency.conversion]] : []),
  ];
  return `${rows.map(csvRow).join("\n")}\n`;
}

// Backslashes first, then pipes, so a value can't escape its own cell (CodeQL js/incomplete-sanitization).
const mdCell = (value: string) => value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");

function toMarkdown(statement: Statement, includeTitles: boolean): string {
  const { project, period } = statement;
  const header = [
    ...(project.client ? [`Client: ${project.client}`] : []),
    ...(project.billingCode ? [`Billing code: ${project.billingCode}`] : []),
    `${period.since} to ${period.until} (${period.timeZone})`,
    statement.status === "issued" ? `Issued ${statement.issuedAt}` : "Draft",
  ].join(" · ");
  const out = [`# Statement: ${mdCell(project.name)}, ${period.label}`, "", header, ""];
  out.push("| Channel | Model | Basis | Turns | Amount |", "|---|---|---|---:|---:|");
  for (const line of statement.lines) {
    const channel = line.channel ? channelLabel(line.channel) : "unknown channel";
    out.push(`| ${mdCell(channel)} | ${mdCell(line.model)} | ${line.basis}${line.apiEquivalent ? " (API-equivalent)" : ""} | ${line.turns} | ${fixed2(line.amount)} ${unitName(line.currency)} |`);
  }
  out.push("");
  for (const line of statement.unknown) {
    out.push(`${line.turns} ${line.turns === 1 ? "turn" : "turns"} with no known cost (${line.reason}): not included in the totals.`);
  }
  for (const line of statement.excluded) {
    out.push(`${line.turns} ${line.turns === 1 ? "turn" : "turns"} left off (${line.reason}).`);
  }
  if (statement.unknown.length + statement.excluded.length > 0) out.push("");
  if (statement.fixedLines.length > 0) {
    out.push(...statement.fixedLines.map((line) => `- ${mdCell(line.label)}: ${fixed2(line.amount)} ${unitName(line.currency)}`), "");
  }
  out.push("| Currency | Lines | Markup | Fixed | Total |", "|---|---:|---:|---:|---:|");
  for (const total of statement.totals) {
    out.push(`| ${unitName(total.currency)} | ${fixed2(total.lines)} | ${fixed2(total.markup)} | ${fixed2(total.fixed)} | **${fixed2(total.total)}** |`);
  }
  out.push("", statement.conversion);
  if (statement.userCurrency) {
    out.push(`In all: ${statement.userCurrency.code} ${fixed2(statement.userCurrency.total)} (${statement.userCurrency.conversion})`);
  }
  out.push("", `Coverage: ${statement.coverage.knownTurns} of ${statement.coverage.turns} turns have a known cost.`, "", "## Sessions", "");
  for (const session of statement.provenance.sessions) {
    out.push(`- ${session.providerId}:${session.sessionId}${includeTitles && session.title ? ` ${mdCell(session.title)}` : ""}`);
  }
  out.push("", `Analyzer ${statement.provenance.appVersion} · price book ${statement.provenance.priceBookHash} · projects file ${statement.provenance.projectsFileHash}`, "");
  return out.join("\n");
}

export function exportStatement(statement: Statement, format: StatementExportFormat, options: StatementExportOptions = {}): string {
  const includeTitles = options.includeTitles ?? true;
  const shown = includeTitles ? statement : withoutTitles(statement);
  if (format === "json") return `${JSON.stringify(shown, null, 2)}\n`;
  if (format === "csv") return toCsv(shown);
  return toMarkdown(shown, includeTitles);
}
