// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CacheOutcome } from "@agent-cost-analyzer/domain";

const META: Record<CacheOutcome, { glyph: string; label: string; word: string }> = {
  hit: { glyph: "●", label: "Cache hit", word: "Hit" },
  partial: { glyph: "◐", label: "Cache partial hit", word: "Partial" },
  miss: { glyph: "○", label: "Cache miss", word: "Miss" },
  unknown: { glyph: "?", label: "Cache outcome unknown", word: "Unknown" },
};

export function cacheOutcomeWord(outcome: CacheOutcome): string {
  return META[outcome].word;
}

// Shape plus text, never colour alone; it inherits the table's text colour,
// so it reads in every theme. With `showWord` (a replay's Cache column,
// step 14.7) the word shows beside the glyph, and is what's read out.
export function CacheOutcomeBadge({ outcome, showWord = false }: { outcome: CacheOutcome; showWord?: boolean }) {
  const { glyph, label, word } = META[outcome];
  return (
    <span className={showWord ? "cache-outcome" : undefined}>
      <span aria-hidden="true">{glyph}</span>
      {showWord ? word : <span className="sr-only">{label}</span>}
    </span>
  );
}
