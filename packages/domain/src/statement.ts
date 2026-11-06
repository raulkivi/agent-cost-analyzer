import { z } from "zod";
import { costBasisSchema, currencySchema, type Currency } from "./cost-figure.js";
import { isoCalendarDateSchema } from "./price-book.js";
import { fixedLineSchema } from "./projects.js";

// Phase 15 step 15.11 (docs/plans/cost-by-repository-and-project.md §8.5,
// D2, D4, D6, D13–D15): a billing statement for one project and one period.
// A draft is built from the logs on demand; issuing freezes it as JSON and
// it is never recomputed. A re-run is compared with the frozen copy
// (diffStatements). Lines are per basis, currency, channel, model and price
// version; turns with no known cost are listed with their reason, never
// summed as 0; subscription (API-equivalent) use is left off unless the
// project opts in (D4). Totals stay per currency; a user currency, if the
// project sets one, is converted at its fixed rate and says so (D14).

export const STATEMENT_VERSION = 1;

const count = z.number().int().nonnegative();
const money = z.number().nonnegative();
const tokens = z.number().nonnegative().nullable(); // null: unknown

export const statementPeriodSchema = z.object({
  key: z.string().regex(/^\d{4}-\d{2}(-\d{2}_\d{4}-\d{2}-\d{2})?$/), // "2026-10" or "2026-10-01_2026-10-15"
  label: z.string(),
  since: isoCalendarDateSchema,
  until: isoCalendarDateSchema,
  timeZone: z.string().min(1), // IANA; the days are calendar days there (D6)
});

export const statementTokensSchema = z.object({
  uncachedInput: tokens,
  cacheRead: tokens,
  cacheWrite: tokens,
  reasoning: tokens,
  output: tokens,
});

export const statementLineSchema = z.object({
  key: z.string(), // basis|currency|channel|model|priceVersionId
  basis: costBasisSchema,
  currency: currencySchema,
  channel: z.string().nullable(),
  model: z.string(),
  priceVersionId: z.string().nullable(), // priced lines only
  sessions: count,
  turns: count,
  tokens: statementTokensSchema,
  // Priced lines: what each type cost per 1M tokens, in the line's currency.
  unitPrices: z
    .object({ uncachedInput: z.number().nullable(), cacheRead: z.number().nullable(), cacheWrite: z.number().nullable(), output: z.number().nullable() })
    .nullable(),
  amount: money,
  apiEquivalent: z.boolean(),
});

const groupLineSchema = z.object({ reason: z.string(), turns: count, sessions: count });

export const statementTotalSchema = z.object({
  currency: currencySchema,
  lines: money,
  markup: money,
  fixed: money,
  total: money,
});

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

export const statementSchema = z
  .object({
    version: z.literal(STATEMENT_VERSION),
    status: z.enum(["draft", "issued"]),
    generatedAt: z.string(),
    issuedAt: z.string().optional(),
    project: z.object({ id: z.string(), name: z.string(), client: z.string().optional(), billingCode: z.string().optional() }),
    period: statementPeriodSchema,
    includeSubscriptionUse: z.boolean(),
    conversion: z.string(),
    lines: z.array(statementLineSchema),
    unknown: z.array(groupLineSchema), // no known cost: counted, never 0
    excluded: z.array(groupLineSchema), // known but left off (D4)
    markupPercent: z.number().nonnegative().optional(),
    markup: z.array(z.object({ currency: currencySchema, base: money, amount: money })),
    fixedLines: z.array(fixedLineSchema),
    totals: z.array(statementTotalSchema), // AI Credits first
    userCurrency: z.object({ code: z.string(), perUsd: z.number().positive(), total: money, conversion: z.string() }).optional(),
    coverage: z.object({ turns: count, knownTurns: count }),
    provenance: z.object({
      appVersion: z.string(),
      priceBookHash: z.string(),
      projectsFileHash: z.string(),
      priceVersionIds: z.array(z.string()),
      sessions: z.array(z.object({ providerId: z.string(), sessionId: z.string(), title: z.string().optional() })),
    }),
  })
  .superRefine((statement, ctx) => {
    if ((statement.status === "issued") !== (statement.issuedAt !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["issuedAt"], message: "issuedAt is set exactly when the statement is issued" });
    }
    statement.totals.forEach((total, index) => {
      if (!near(total.lines + total.markup + total.fixed, total.total)) {
        ctx.addIssue({ code: "custom", path: ["totals", index], message: "a total is its lines, markup and fixed lines" });
      }
    });
  });

export type StatementPeriod = z.infer<typeof statementPeriodSchema>;
export type StatementLine = z.infer<typeof statementLineSchema>;
export type StatementTotal = z.infer<typeof statementTotalSchema>;
export type Statement = z.infer<typeof statementSchema>;

// ---- the diff of a re-run against the frozen copy ----

export const statementDiffSchema = z.object({
  changed: z.boolean(),
  lines: z.array(
    z.object({
      key: z.string(),
      change: z.enum(["added", "removed", "changed"]),
      issued: z.number().nullable(),
      current: z.number().nullable(),
      difference: z.number(),
    }),
  ),
  totals: z.array(z.object({ currency: currencySchema, issued: z.number(), current: z.number(), difference: z.number() })),
  unknownTurns: z.object({ issued: count, current: count }),
  sessions: z.object({ added: z.array(z.string()), removed: z.array(z.string()) }),
  inputs: z.object({ priceBookChanged: z.boolean(), projectsFileChanged: z.boolean() }),
});

export type StatementDiff = z.infer<typeof statementDiffSchema>;

const round = (value: number) => Math.round(value * 1e9) / 1e9;
const sessionKeys = (statement: Statement) => statement.provenance.sessions.map((session) => `${session.providerId}:${session.sessionId}`);
const unknownTurns = (statement: Statement) => statement.unknown.reduce((sum, line) => sum + line.turns, 0);
const CURRENCIES: readonly Currency[] = ["AI_CREDITS", "USD"];

export function diffStatements(issued: Statement, current: Statement): StatementDiff {
  const before = new Map(issued.lines.map((line) => [line.key, line]));
  const after = new Map(current.lines.map((line) => [line.key, line]));
  const lines: StatementDiff["lines"] = [];
  for (const line of current.lines) {
    const old = before.get(line.key);
    if (!old) lines.push({ key: line.key, change: "added", issued: null, current: line.amount, difference: round(line.amount) });
    else if (!near(old.amount, line.amount) || old.turns !== line.turns) {
      lines.push({ key: line.key, change: "changed", issued: old.amount, current: line.amount, difference: round(line.amount - old.amount) });
    }
  }
  for (const line of issued.lines) {
    if (!after.has(line.key)) lines.push({ key: line.key, change: "removed", issued: line.amount, current: null, difference: round(-line.amount) });
  }
  const totalOf = (statement: Statement, currency: Currency) => statement.totals.find((total) => total.currency === currency)?.total ?? 0;
  const totals = CURRENCIES.filter((currency) => [...issued.totals, ...current.totals].some((total) => total.currency === currency)).map((currency) => ({
    currency,
    issued: totalOf(issued, currency),
    current: totalOf(current, currency),
    difference: round(totalOf(current, currency) - totalOf(issued, currency)),
  }));
  const was = new Set(sessionKeys(issued));
  const now = new Set(sessionKeys(current));
  const sessions = { added: [...now].filter((key) => !was.has(key)), removed: [...was].filter((key) => !now.has(key)) };
  const inputs = {
    priceBookChanged: issued.provenance.priceBookHash !== current.provenance.priceBookHash,
    projectsFileChanged: issued.provenance.projectsFileHash !== current.provenance.projectsFileHash,
  };
  const unknown = { issued: unknownTurns(issued), current: unknownTurns(current) };
  const changed =
    lines.length > 0 || totals.some((total) => total.difference !== 0) || sessions.added.length > 0 || sessions.removed.length > 0 || unknown.issued !== unknown.current;
  return { changed, lines, totals, unknownTurns: unknown, sessions, inputs };
}

// ---- periods (D6, D15) ----

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = MONTHS.map((month) => month.slice(0, 3));

function validTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

// "YYYY-MM" or "YYYY-MM-DD..YYYY-MM-DD"; null when it is neither or the zone is unknown.
export function parseStatementPeriod(text: string, timeZone: string): StatementPeriod | null {
  if (!validTimeZone(timeZone)) return null;
  const month = /^(\d{4})-(\d{2})$/.exec(text);
  if (month) {
    const year = Number(month[1]);
    const number = Number(month[2]);
    if (number < 1 || number > 12) return null;
    const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
    return { key: text, label: `${MONTHS[number - 1]} ${year}`, since: `${text}-01`, until: `${text}-${String(last).padStart(2, "0")}`, timeZone };
  }
  const range = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(text);
  if (!range || !validDate(range[1]!) || !validDate(range[2]!) || range[1]! > range[2]!) return null;
  const [since, until] = [range[1]!, range[2]!];
  const short = (date: string) => `${SHORT[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
  const label = since.slice(0, 4) === until.slice(0, 4) ? `${short(since)} – ${short(until)}, ${until.slice(0, 4)}` : `${short(since)}, ${since.slice(0, 4)} – ${short(until)}, ${until.slice(0, 4)}`;
  return { key: `${since}_${until}`, label, since, until, timeZone };
}

// The calendar date of an instant in a time zone (D6).
export function localDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

// D15: a period can be issued once its last day has passed where it is billed.
export function periodHasEnded(period: StatementPeriod, now: Date): boolean {
  return localDate(now, period.timeZone) > period.until;
}

// What GET /api/statements and MCP get_statement answer: the frozen copy if
// the period is issued (with the re-run and its exact diff), else the draft;
// whether it can be issued now (D15) and why not; the project's issued periods.
export const statementAnswerSchema = z.object({
  statement: statementSchema,
  rerun: statementSchema.optional(),
  diff: statementDiffSchema.optional(),
  canIssue: z.object({ ok: z.boolean(), reason: z.string().optional() }),
  issuedPeriods: z.array(z.string()),
});

export type StatementAnswer = z.infer<typeof statementAnswerSchema>;
