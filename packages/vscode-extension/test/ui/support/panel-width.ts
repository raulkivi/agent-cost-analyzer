// The window can't be resized through the driver, and VS Code's minimum
// window is about 400 px, so check 1.9 sets the panel's width through the
// editor layout: its group takes a share of the editor area. The webview is
// a little narrower than its group (scrollbar, padding), so the share is
// nudged proportionally until the webview measures the target.
export const WIDTH_TOLERANCE_PX = 8;
const MIN_FRACTION = 0.05;
const MAX_FRACTION = 0.95;

export function nextGroupFraction(currentFraction: number, measuredWidth: number, targetWidth: number): number {
  if (!(measuredWidth > 0)) throw new Error("The panel's width was not measured");
  const next = (currentFraction * targetWidth) / measuredWidth;
  return Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, next));
}

export function isWithinTolerance(actual: number, target: number): boolean {
  return Math.abs(actual - target) <= WIDTH_TOLERANCE_PX;
}
