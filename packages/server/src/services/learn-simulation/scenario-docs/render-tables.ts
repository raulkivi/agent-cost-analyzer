// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Session, TokenCount, Turn } from "@agent-cost-analyzer/domain";

export interface SectionOptions {
  // Display name of the simulated model, e.g. "Claude Sonnet 5.5".
  referenceModel: string;
  // Oldest source date of the price data the numbers rest on.
  checkedAt: string;
}

const USD_PER_AI_CREDIT = 0.01;
const NA = "n/a";

const value = (count: TokenCount): number | undefined =>
  count.known ? count.value : undefined;
const cell = (n: number | undefined): string =>
  n === undefined ? NA : String(n);
// The repo rounds AI Credits to 2 decimals everywhere it shows them.
const credits = (n: number | undefined): string =>
  n === undefined ? NA : n.toFixed(2);
const escapeCell = (text: string): string =>
  text
    .replace(/\s*\n\s*/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|");
const bold = (text: string): string => `**${text}**`;

interface Row {
  index: number;
  text: string;
  model: string;
  write?: number;
  read?: number;
  uncached?: number;
  tool: number;
  vision: number;
  reasoning: number;
  output: number;
  credits?: number;
}

function toRow(turn: Turn): Row {
  const u = turn.usage;
  return {
    index: turn.index,
    text: escapeCell(turn.explanation),
    model: u.model,
    write: value(u.cacheWrite),
    read: value(u.cacheRead),
    uncached: value(u.uncachedInput),
    tool: value(u.tool) ?? 0,
    vision: value(u.vision) ?? 0,
    reasoning: value(u.reasoning) ?? 0,
    output: value(u.output) ?? 0,
    credits: value(u.costAiCredits),
  };
}

// Unknown input counts make the turn's total unknown too (never a partial sum).
function turnTotal(row: Row): number | undefined {
  if (
    row.write === undefined ||
    row.read === undefined ||
    row.uncached === undefined
  ) {
    return undefined;
  }
  return row.uncached + row.write + row.read + row.reasoning + row.output;
}

function perTurnTable(rows: Row[], showModel: boolean): string[] {
  const head = [
    "Turn",
    "What happens",
    ...(showModel ? ["Model"] : []),
    "Cache write",
    "Cache read",
    "Cache size after",
    "Uncached input",
    "Tool (in input)",
    "Vision (in input)",
    "Reasoning",
    "Output text",
    "**Turn total**",
    "**Turn AI Credits**",
  ];
  const textColumns = showModel ? 3 : 2;
  const lines = [
    `| ${head.join(" | ")} |`,
    `|${"---|".repeat(textColumns)}${"---:|".repeat(head.length - textColumns)}`,
  ];
  for (const row of rows) {
    const size =
      row.write === undefined || row.read === undefined
        ? undefined
        : row.write + row.read;
    const cells = [
      String(row.index),
      row.text,
      ...(showModel ? [row.model] : []),
      cell(row.write),
      cell(row.read),
      cell(size),
      cell(row.uncached),
      String(row.tool),
      String(row.vision),
      String(row.reasoning),
      String(row.output),
      bold(cell(turnTotal(row))),
      bold(credits(row.credits)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines;
}

// Running sums stay unknown from the first unknown turn onward.
function runningSum(
  rows: Row[],
  pick: (row: Row) => number | undefined,
): (number | undefined)[] {
  const out: (number | undefined)[] = [];
  let sum: number | undefined = 0;
  for (const row of rows) {
    const next = pick(row);
    sum = sum === undefined || next === undefined ? undefined : sum + next;
    out.push(sum);
  }
  return out;
}

function cumulativeTable(rows: Row[]): string[] {
  const head = [
    "Cumulative through turn",
    "What happens",
    "Cache write",
    "Cache read",
    "Uncached input",
    "Tool (in input)",
    "Vision (in input)",
    "Reasoning",
    "Output text",
    "**Session total**",
    "**Running AI Credits**",
  ];
  const write = runningSum(rows, (r) => r.write);
  const read = runningSum(rows, (r) => r.read);
  const uncached = runningSum(rows, (r) => r.uncached);
  const tool = runningSum(rows, (r) => r.tool);
  const vision = runningSum(rows, (r) => r.vision);
  const reasoning = runningSum(rows, (r) => r.reasoning);
  const output = runningSum(rows, (r) => r.output);
  const total = runningSum(rows, turnTotal);
  const money = runningSum(rows, (r) => r.credits);
  const lines = [
    `| ${head.join(" | ")} |`,
    `|---|---|${"---:|".repeat(head.length - 2)}`,
  ];
  rows.forEach((row, i) => {
    const cells = [
      String(row.index),
      row.text,
      cell(write[i]),
      cell(read[i]),
      cell(uncached[i]),
      cell(tool[i]),
      cell(vision[i]),
      cell(reasoning[i]),
      cell(output[i]),
      bold(cell(total[i])),
      bold(credits(money[i])),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });
  return lines;
}

function summary(rows: Row[]): string {
  if (rows.some((row) => row.credits === undefined)) {
    return "Session total: unavailable, because at least one turn's cost is unknown.";
  }
  const sum = rows.reduce((acc, row) => acc + (row.credits ?? 0), 0);
  const priciest = rows.reduce((a, b) =>
    (b.credits ?? 0) > (a.credits ?? 0) ? b : a,
  );
  const usd = (sum * USD_PER_AI_CREDIT).toFixed(4);
  return (
    `Session total: **${credits(sum)} AI Credits** (≈ $${usd}); ` +
    `most expensive turn: **turn ${priciest.index}** (${credits(priciest.credits)} AI Credits).`
  );
}

function chart(rows: Row[]): string[] {
  if (
    rows.some(
      (r) =>
        r.write === undefined ||
        r.read === undefined ||
        r.uncached === undefined,
    )
  ) {
    return [];
  }
  const series: [string, (r: Row) => number][] = [
    ["Cache write", (r) => r.write ?? 0],
    ["Cache read", (r) => r.read ?? 0],
    ["Uncached input", (r) => r.uncached ?? 0],
    ["Tool", (r) => r.tool],
    ["Vision", (r) => r.vision],
    ["Reasoning", (r) => r.reasoning],
    ["Output text", (r) => r.output],
  ];
  const peak = Math.max(
    1,
    ...rows.flatMap((r) => series.map(([, pick]) => pick(r))),
  );
  const top = Math.ceil(peak / 1000) * 1000;
  return [
    "```mermaid",
    "xychart-beta",
    '    title "Tokens per turn by type (simulated)"',
    `    x-axis [${rows.map((r) => `Turn${r.index}`).join(", ")}]`,
    `    y-axis "Tokens" 0 --> ${top}`,
    ...series.map(
      ([name, pick]) => `    bar "${name}" [${rows.map(pick).join(", ")}]`,
    ),
    "```",
  ];
}

// The generated part of a scenario doc: every number in it comes from the
// simulator (D7), so the prose around it never has to quote one.
export function renderSessionSection(
  session: Session,
  options: SectionOptions,
): string {
  const rows = session.turns.map(toRow);
  const showModel = new Set(rows.map((row) => row.model)).size > 1;
  return [
    `Simulated on ${options.referenceModel} (and its cheaper sibling where a scenario switches models) with the real per-token prices in GitHub's Copilot price table, checked ${options.checkedAt}. The figures come from the Learn simulator, not from a live session. Tool and Vision tokens are part of the input columns, not added to them.`,
    "",
    ...perTurnTable(rows, showModel),
    "",
    summary(rows),
    "",
    "Running totals by token type:",
    "",
    ...cumulativeTable(rows),
    "",
    ...chart(rows),
  ]
    .join("\n")
    .trimEnd();
}
