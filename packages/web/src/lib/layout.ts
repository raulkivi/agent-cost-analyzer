// vscode-extension.md §3.5 Layout, by the room the panel leaves for the
// turns and the right column (an editor panel can be much narrower than the
// window, and the session list column takes its share):
// - wide: turns table plus the right column side by side;
// - medium: the right column becomes a drawer;
// - narrow: priority turn columns, a details drawer, a view <select>
//   instead of tabs, and 2×2 KPIs.
// Step 10.11: the turns table scrolls inside its column at every layout, so
// these thresholds decide what reads well, not what fits.
export type Layout = "wide" | "medium" | "narrow";

// The session list column and the grid's own spacing (App.tsx).
export const LIST_COLUMN_WIDTH = 240;
const GRID_GAP = 16;
const GRID_PADDING = 2 * 16;

// The room the turns need: wide puts a 320 px right column beside at least
// 624 px of turns; medium needs room for the table's priority columns.
const WIDE_CONTENT_WIDTH = 960;
const MEDIUM_CONTENT_WIDTH = 480;

export const MIN_SUPPORTED_WIDTH = 360;

export interface LayoutOptions {
  // Whether the session list sits beside the turns (not in the extension's
  // Analyze mode, whose sidebar lists the sessions).
  listColumn: boolean;
}

// An unmeasured width (no ResizeObserver, or 0 before the first layout, as
// in jsdom) keeps the wide layout rather than flashing the narrow one.
export function layoutFor(width: number | undefined, { listColumn }: LayoutOptions): Layout {
  if (!width) return "wide";
  const contentWidth = width - GRID_PADDING - (listColumn ? LIST_COLUMN_WIDTH + GRID_GAP : 0);
  if (contentWidth >= WIDE_CONTENT_WIDTH) return "wide";
  return contentWidth >= MEDIUM_CONTENT_WIDTH ? "medium" : "narrow";
}
