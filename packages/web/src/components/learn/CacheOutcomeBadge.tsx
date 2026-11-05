import type { CacheOutcome } from "@agent-cost-analyzer/domain";

const META: Record<CacheOutcome, { glyph: string; label: string }> = {
  hit: { glyph: "●", label: "Cache hit" },
  partial: { glyph: "◐", label: "Cache partial hit" },
  miss: { glyph: "○", label: "Cache miss" },
  unknown: { glyph: "?", label: "Cache outcome unknown" },
};

// Shape plus text, never colour alone; it inherits the table's text colour,
// so it reads in every theme.
export function CacheOutcomeBadge({ outcome }: { outcome: CacheOutcome }) {
  const { glyph, label } = META[outcome];
  return (
    <span>
      <span aria-hidden="true">{glyph}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
