// Diffs the vendor profiles' prices against GitHub's published Copilot price
// table (docs/plans/vendor-aware-learn-simulation.md §6, step 13.9). It only
// reports: it never edits the profiles, because a price change is a reviewed,
// sourced data change.
//
//   npm run vendor-prices:diff -- --dry-run            # committed snapshot, offline
//   npm run vendor-prices:diff -- --table <file>       # a local copy of the table
//   npm run vendor-prices:diff -- --out report.md      # fetches github/docs main
//
// With GITHUB_OUTPUT set (GitHub Actions) it also writes `changed=true|false`.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadVendorProfiles } from "../src/data-sources/vendor-profiles/loader.ts";
import {
  diffPrices,
  formatDiffReport,
  hasDifferences,
  parsePriceTable,
} from "../src/data-sources/vendor-profiles/price-diff.ts";

const TABLE_URL =
  "https://raw.githubusercontent.com/github/docs/main/data/tables/copilot/models-and-pricing.yml";
const here = path.dirname(fileURLToPath(import.meta.url));
const profilesDir = path.resolve(here, "../fixtures/vendor-profiles");
const snapshot = path.join(profilesDir, "copilot-price-table.snapshot.yml");

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function readTable(): Promise<string> {
  const local = option("--table") ?? (process.argv.includes("--dry-run") ? snapshot : undefined);
  if (local !== undefined) return readFileSync(local, "utf-8");
  const response = await fetch(TABLE_URL);
  if (!response.ok) throw new Error(`Fetching ${TABLE_URL} failed: HTTP ${response.status}`);
  return response.text();
}

const diff = diffPrices(loadVendorProfiles(profilesDir), parsePriceTable(await readTable()));
const report = formatDiffReport(diff);

const out = option("--out");
if (out === undefined) process.stdout.write(report);
else writeFileSync(out, report);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `changed=${hasDifferences(diff)}\n`);
}
