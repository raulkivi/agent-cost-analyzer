// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { findPriceVersionConflicts, type PriceBookEntry, type PriceBookProblem, type Source } from "@agent-cost-analyzer/domain";
import type { PriceBookData, PriceBookSource } from "./price-book-source.js";

// Phase 15 step 15.5 (plan §9): the bundled book, then the user's versions.
// A user version that clashes with one already in the book (same id, or an
// overlap in the same precedence class: a list price over a bundled list
// price, two contracts with one scope) is left out with a problem, so the
// book never holds two answers for one turn. Precedence between the kept
// versions (contract over list) is PriceBook.priceFor's.

// User versions come from the projects file, so their problems point there.
function userPath(index: number): string {
  return `channels.priceVersions[${index}]`;
}

export class CompositePriceBookSource implements PriceBookSource {
  constructor(private readonly sources: readonly PriceBookSource[]) {}

  load(): PriceBookData {
    const versions: PriceBookEntry[] = [];
    const sources = new Map<string, Source>();
    const problems: PriceBookProblem[] = [];
    for (const source of this.sources) {
      const data = source.load();
      problems.push(...data.problems);
      for (const cited of data.sources) if (!sources.has(cited.id)) sources.set(cited.id, cited);
      let userIndex = 0;
      for (const version of data.versions) {
        const index = version.origin === "user" ? userIndex++ : undefined;
        const problem = this.clash(versions, version);
        if (problem === undefined) {
          versions.push(version);
        } else if (index !== undefined) {
          problems.push({ path: problem.onId ? `${userPath(index)}.id` : userPath(index), message: problem.message });
        } else {
          throw new Error(`Price book: ${problem.message}`);
        }
      }
    }
    return { versions, sources: [...sources.values()], problems };
  }

  private clash(kept: PriceBookEntry[], candidate: PriceBookEntry): { message: string; onId: boolean } | undefined {
    if (kept.some((version) => version.id === candidate.id)) {
      return { message: `Price version id "${candidate.id}" is already in the price book; give it another id.`, onId: true };
    }
    const sameModel = kept.filter((version) => version.channel === candidate.channel && version.modelId === candidate.modelId);
    const overlap = findPriceVersionConflicts([...sameModel, candidate]).overlaps.find(
      ({ first, second }) => first === candidate.id || second === candidate.id,
    );
    if (overlap === undefined) return undefined;
    const other = overlap.first === candidate.id ? overlap.second : overlap.first;
    return {
      message: `"${candidate.id}" overlaps "${other}": two prices of ${candidate.modelId} on ${candidate.channel} for the same time and scope, so it is left out.`,
      onId: false,
    };
  }
}
