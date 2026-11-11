// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Geometry of U15's range bar: a scale from 0 to a round maximum above p90,
// so the bar and its two ticks sit at honest places. Pure.

export interface RangeBar {
  max: number;
  startPercent: number; // p50
  endPercent: number; // p90
}

// 1, 2, 2.5, 5 or 10 times a power of ten: the smallest that holds the value.
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * power >= value) ?? 10;
  return step * power;
}

export function rangeBar(p50: number, p90: number): RangeBar {
  const max = niceMax(p90);
  return { max, startPercent: (p50 / max) * 100, endPercent: (p90 / max) * 100 };
}
