// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ModelPrice, VendorProfile } from "@agent-cost-analyzer/domain";

// One row of GitHub's models-and-pricing table: a model has one row per
// pricing tier. Prices are USD per 1M tokens; `null` is "Not applicable".
export interface PriceRow {
  model: string;
  input: number;
  cachedInput: number;
  output: number;
  cacheWrite: number | null;
}

export interface PriceDiff {
  added: string[];
  removed: string[];
  changed: { model: string; differences: string[] }[];
}

function unquote(value: string): string {
  const quoted = /^(['"])(.*)\1$/.exec(value);
  return quoted ? quoted[2]! : value;
}

function parsePrice(
  model: string,
  field: string,
  raw: string | undefined,
  allowNotApplicable: boolean,
): number | null {
  // Google and xAI rows have no cache_write column at all: no write price.
  if (raw === undefined && allowNotApplicable) return null;
  if (raw === undefined) throw new Error(`${model}: missing ${field}`);
  if (allowNotApplicable && raw === "Not applicable") return null;
  const match = /^\$(\d+(?:\.\d+)?)$/.exec(raw);
  if (!match) throw new Error(`${model}: cannot read ${field} "${raw}"`);
  return Number(match[1]);
}

// The table is a flat YAML list of one-level mappings. A small parser keeps
// the CLI free of a YAML dependency and fails loudly on a shape it doesn't
// know, so a format change in github/docs surfaces as an error, not a diff.
export function parsePriceTable(text: string): PriceRow[] {
  const blocks: Record<string, string>[] = [];
  for (const line of text.split("\n")) {
    if (/^\s*(#|$)/.test(line)) continue;
    const start = /^- (\w+):\s*(.*)$/.exec(line);
    if (start) {
      blocks.push({ [start[1]!]: unquote(start[2]!.trim()) });
      continue;
    }
    const field = /^\s+(\w+):\s*(.*)$/.exec(line);
    if (field && blocks.length > 0) {
      blocks[blocks.length - 1]![field[1]!] = unquote(field[2]!.trim());
    }
  }
  return blocks.map((block) => {
    // "Name[^footnote]" marks a promotional-price footnote in the docs source.
    const model = block.model?.replace(/\[\^[^\]]*\]$/, "");
    if (model === undefined) throw new Error("a table row has no model name");
    return {
      model,
      input: parsePrice(model, "input", block.input, false)!,
      cachedInput: parsePrice(
        model,
        "cached_input",
        block.cached_input,
        false,
      )!,
      output: parsePrice(model, "output", block.output, false)!,
      cacheWrite: parsePrice(model, "cache_write", block.cache_write, true),
    };
  });
}

const usd = (value: number | null): string =>
  value === null ? "n/a" : `$${value}`;

function compareModel(model: ModelPrice, rows: PriceRow[]): string[] {
  if (model.tiers.length !== rows.length) {
    return [`tiers: profile ${model.tiers.length} → table ${rows.length}`];
  }
  const differences: string[] = [];
  model.tiers.forEach((tier, index) => {
    const row = rows[index]!;
    const pairs: [string, number | null, number | null][] = [
      ["input", tier.inputUsdPerM, row.input],
      ["cachedInput", tier.cachedInputUsdPerM, row.cachedInput],
      ["cacheWrite", tier.cacheWriteUsdPerM, row.cacheWrite],
      ["output", tier.outputUsdPerM, row.output],
    ];
    for (const [field, profileValue, tableValue] of pairs) {
      if (profileValue !== tableValue) {
        differences.push(
          `tier ${index + 1} ${field}: profile ${usd(profileValue)} → table ${usd(tableValue)}`,
        );
      }
    }
  });
  return differences;
}

export function diffPrices(
  profiles: VendorProfile[],
  rows: PriceRow[],
): PriceDiff {
  const byModel = new Map<string, PriceRow[]>();
  for (const row of rows)
    byModel.set(row.model, [...(byModel.get(row.model) ?? []), row]);
  const profileModels = profiles.flatMap((profile) => profile.models);
  const known = new Set(profileModels.map((model) => model.displayName));

  const diff: PriceDiff = {
    added: [...byModel.keys()].filter((name) => !known.has(name)),
    removed: [],
    changed: [],
  };
  for (const model of profileModels) {
    const tableRows = byModel.get(model.displayName);
    if (tableRows === undefined) {
      diff.removed.push(model.displayName);
      continue;
    }
    const differences = compareModel(model, tableRows);
    if (differences.length > 0)
      diff.changed.push({ model: model.displayName, differences });
  }
  return diff;
}

export function hasDifferences(diff: PriceDiff): boolean {
  return diff.added.length + diff.removed.length + diff.changed.length > 0;
}

export function formatDiffReport(diff: PriceDiff): string {
  if (!hasDifferences(diff)) {
    return "No differences between the vendor profiles and GitHub's price table.\n";
  }
  const lines: string[] = [];
  if (diff.added.length > 0) {
    lines.push("## Added", "", ...diff.added.map((name) => `- ${name}`), "");
  }
  if (diff.removed.length > 0) {
    lines.push(
      "## Removed",
      "",
      ...diff.removed.map((name) => `- ${name}`),
      "",
    );
  }
  if (diff.changed.length > 0) {
    lines.push("## Changed", "");
    for (const change of diff.changed) {
      lines.push(
        `- **${change.model}**`,
        ...change.differences.map((line) => `  - ${line}`),
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
