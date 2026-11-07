// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { findPriceVersionConflicts, priceBookChannelFileSchema, type PriceBookEntry, type Source } from "@agent-cost-analyzer/domain";
import type { PriceBookData, PriceBookSource } from "./price-book-source.js";

// Phase 15 step 15.5: the app's own price history, one file per channel in
// fixtures/price-book/<channel>.json. Read once and checked like the vendor
// profiles: bad bundled data stops startup rather than price turns wrongly.

// Resolved lazily: a single-file bundle passes its own directory instead (G4).
export function defaultPriceBookDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/price-book");
}

function readChannelFile(dir: string, file: string): { versions: PriceBookEntry[]; sources: Source[] } {
  const parsed = priceBookChannelFileSchema.safeParse(JSON.parse(readFileSync(path.join(dir, file), "utf-8")));
  if (!parsed.success) throw new Error(`Price book "${file}" is invalid: ${parsed.error.message}`);
  const { channel, sources, versions } = parsed.data;
  const fail = (problem: string): never => {
    throw new Error(`Price book "${file}": ${problem}`);
  };
  if (file !== `${channel}.json`) fail(`its channel is "${channel}", so the file must be named "${channel}.json"`);
  const sourceIds = new Set(sources.map((source) => source.id));
  if (sourceIds.size !== sources.length) fail("a source id is used twice");
  for (const version of versions) {
    if (version.channel !== channel) fail(`version "${version.id}" is on channel "${version.channel}"`);
    if (version.kind === "contract") fail(`version "${version.id}" is a contract; contract prices belong in the user's projects file`);
    if (version.sourceIds.length === 0) fail(`version "${version.id}" cites no source`);
    const missing = version.sourceIds.find((id) => !sourceIds.has(id));
    if (missing !== undefined) fail(`version "${version.id}" cites unknown source "${missing}"`);
  }
  return { versions: versions.map((version) => ({ ...version, origin: "bundled" as const })), sources };
}

export class BundledPriceBookSource implements PriceBookSource {
  private readonly data: PriceBookData;

  constructor(dir: string = defaultPriceBookDir()) {
    const files = readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .sort();
    const versions: PriceBookEntry[] = [];
    const sources = new Map<string, Source>();
    for (const file of files) {
      const read = readChannelFile(dir, file);
      for (const source of read.sources) {
        const known = sources.get(source.id);
        if (known !== undefined && !isDeepStrictEqual(known, source)) {
          throw new Error(`Price book "${file}": source "${source.id}" differs from the one another channel file cites`);
        }
        sources.set(source.id, source);
      }
      versions.push(...read.versions);
    }

    const ids = new Set<string>();
    for (const version of versions) {
      if (ids.has(version.id)) throw new Error(`Price book: version id "${version.id}" is used twice`);
      ids.add(version.id);
    }
    const [overlap] = findPriceVersionConflicts(versions).overlaps;
    if (overlap !== undefined) throw new Error(`Price book: version "${overlap.second}" overlaps "${overlap.first}"`);

    this.data = { versions, sources: [...sources.values()], problems: [] };
  }

  load(): PriceBookData {
    return this.data;
  }
}
