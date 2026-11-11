// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CSSProperties, KeyboardEvent } from "react";

// Shared chart chrome: legend (identity never by colour alone — swatch +
// icon + text label) and the rounded-data-end bar path from the dataviz
// mark spec (4px rounded end, square at the baseline).

// Series that colour alone cannot tell apart (stacked segments, outcomes) also
// differ by a fill pattern, a non-colour cue (WCAG 1.4.1; step 10.17 G7, check
// 1.8). Solid first, so a lone series stays plain; HTML bars and legend swatches
// layer a gradient, SVG marks a <pattern> (SeriesPatternDef).
export type SeriesPattern = "solid" | "diagonal" | "dots" | "cross" | "horizontal";
export const SERIES_PATTERNS: readonly SeriesPattern[] = ["solid", "diagonal", "dots", "cross", "horizontal"];

export function patternFor(index: number): SeriesPattern {
  return SERIES_PATTERNS[index % SERIES_PATTERNS.length]!;
}

// White hatching reads on every series colour (each is mid-lightness, 3:1 or
// more on light and dark grounds alike).
const HATCH = "rgba(255, 255, 255, 0.9)";
const GRADIENTS: Record<Exclude<SeriesPattern, "solid">, { image: string; size?: string }> = {
  diagonal: { image: `repeating-linear-gradient(45deg, ${HATCH} 0 2px, transparent 2px 6px)` },
  horizontal: { image: `repeating-linear-gradient(0deg, ${HATCH} 0 2px, transparent 2px 5px)` },
  cross: { image: `repeating-linear-gradient(45deg, ${HATCH} 0 1.5px, transparent 1.5px 6px), repeating-linear-gradient(-45deg, ${HATCH} 0 1.5px, transparent 1.5px 6px)` },
  dots: { image: `radial-gradient(circle, ${HATCH} 1.3px, transparent 1.7px)`, size: "6px 6px" },
};

export function patternFillStyle(color: string, pattern: SeriesPattern): CSSProperties {
  if (pattern === "solid") return { backgroundColor: color };
  const { image, size } = GRADIENTS[pattern];
  return { backgroundColor: color, backgroundImage: image, ...(size ? { backgroundSize: size } : {}) };
}

// The SVG twin of patternFillStyle: a 6px tile of the series colour (the rect
// the UI check reads as the mark) with white hatching on top.
export function SeriesPatternDef({ id, color, pattern }: { id: string; color: string; pattern: Exclude<SeriesPattern, "solid"> }) {
  const stroke = { stroke: HATCH, strokeWidth: 1.5 };
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse">
      <rect data-series-fill="" width="6" height="6" fill={color} />
      {pattern === "diagonal" && <path d="M-1,1 L1,-1 M0,6 L6,0 M5,7 L7,5" {...stroke} />}
      {pattern === "horizontal" && <line x1="0" y1="3" x2="6" y2="3" {...stroke} />}
      {pattern === "cross" && <path d="M-1,1 L1,-1 M0,6 L6,0 M5,7 L7,5 M-1,5 L1,7 M0,0 L6,6 M5,-1 L7,1" {...stroke} />}
      {pattern === "dots" && <circle cx="3" cy="3" r="1.3" fill={HATCH} />}
    </pattern>
  );
}

export interface LegendItem {
  id: string;
  label: string;
  color: string;
  icon?: string;
  pattern?: SeriesPattern;
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="chart-legend" aria-label="Legend">
      {items.map((item) => (
        <li key={item.id}>
          <span className="chart-legend-swatch" style={patternFillStyle(item.color, item.pattern ?? "solid")} aria-hidden="true" />
          {item.icon && <span aria-hidden="true">{item.icon}</span>}
          {item.label}
        </li>
      ))}
    </ul>
  );
}

// Rect with only its top corners rounded (a column's data end).
export function roundedTopRectPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  return [
    `M${x},${y + height}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${y + height}`,
    "Z",
  ].join(" ");
}

export function activateOnEnterOrSpace(action: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      action();
    }
  };
}
