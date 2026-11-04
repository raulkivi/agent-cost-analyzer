// The webview is narrower than the window by the workbench chrome around it
// (activity bar, side bar, editor padding, scrollbar). Measured once at one
// window width, it gives the window width for any webview width (check 1.9).
export const WIDTH_TOLERANCE_PX = 8;

export interface WidthMeasurement {
  windowWidth: number;
  webviewWidth: number;
}

export function windowWidthFor(targetWebviewWidth: number, measured: WidthMeasurement): number {
  const chrome = measured.windowWidth - measured.webviewWidth;
  if (chrome < 0) throw new Error(`The webview (${measured.webviewWidth} px) is wider than the window (${measured.windowWidth} px)`);
  return targetWebviewWidth + chrome;
}

export function isWithinTolerance(actual: number, target: number): boolean {
  return Math.abs(actual - target) <= WIDTH_TOLERANCE_PX;
}
