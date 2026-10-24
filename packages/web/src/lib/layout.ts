// vscode-extension.md §3.5 Layout, by the panel's width (an editor panel
// can be much narrower than the window):
// - wide (1100 px and up): turns table plus the right column, as always;
// - medium (700-1099 px): the right column becomes a drawer;
// - narrow (under 700 px): priority turn columns, a details drawer, a view
//   <select> instead of tabs, and 2×2 KPIs.
export type Layout = "wide" | "medium" | "narrow";

export const WIDE_MIN_WIDTH = 1100;
export const MEDIUM_MIN_WIDTH = 700;
export const MIN_SUPPORTED_WIDTH = 360;

// An unmeasured width (no ResizeObserver, or 0 before the first layout, as
// in jsdom) keeps today's wide layout rather than flashing the narrow one.
export function layoutFor(width: number | undefined): Layout {
  if (!width || width >= WIDE_MIN_WIDTH) return "wide";
  return width >= MEDIUM_MIN_WIDTH ? "medium" : "narrow";
}
