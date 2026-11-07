// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Phase 15 step 15.9 (plan §11.7, dataviz): series identity colours from
// the eight categorical tokens in theme.css (--color-series-1..8), with the
// High Contrast dash patterns (--dash-series-1..8). The order is fixed per
// kind of entity, so filtering never repaints a survivor: a project by its
// position in the projects file, a vendor by VENDOR_ORDER, a repository by
// its place in the sorted list of every repository in the dataset. There is
// never a ninth hue: past the eighth, and for the Unattributed / No project
// bucket, a neutral style (status colours stay reserved for status).

export interface SeriesStyle {
  color: string;
  dash: string;
}

export const MAX_SERIES_COLORS = 8;

export const NEUTRAL_SERIES: SeriesStyle = { color: "var(--color-text-muted)", dash: "none" };

export const VENDOR_ORDER: readonly string[] = ["anthropic", "openai", "google", "xai", "microsoft", "moonshot"];

export function seriesStyle(slot: number): SeriesStyle {
  if (slot < 0 || slot >= MAX_SERIES_COLORS) return NEUTRAL_SERIES;
  return { color: `var(--color-series-${slot + 1})`, dash: `var(--dash-series-${slot + 1})` };
}

export class SeriesPalette {
  private readonly slots: Map<string, number>;

  constructor(order: readonly string[]) {
    this.slots = new Map(order.map((key, index) => [key, index]));
  }

  styleFor(key: string | null): SeriesStyle {
    if (key === null) return NEUTRAL_SERIES;
    return seriesStyle(this.slots.get(key) ?? -1);
  }
}
