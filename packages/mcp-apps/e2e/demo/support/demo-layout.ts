// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// The F recordings show the view alone (plan §4.2): no host chrome, so the
// view's iframe fills the window's height and a view shown later covers the
// earlier ones. Most views cap their card at 640 CSS px (only U2 and U9 grow
// in fullscreen), so the card would be a small island in a 1600x1000 frame:
// the browser runs at DEMO_SCALE (--force-device-scale-factor), which makes
// the card, and its text, larger in the frame. Added to the fake host's page
// by the demo specs only; host-page.ts and the e2e specs are unchanged.
export const DEMO_VIEW_FRAME_SELECTOR = 'iframe[title="MCP App view"]';
// The card's 640 px cap plus its 6 px margin each side.
export const DEMO_VIEW_WIDTH = 652;
export const DEMO_SCALE = 1.15;

export function demoLayoutCss(): string {
  return `
body { margin: 0; padding: 0; overflow: hidden; }
#chat { gap: 0; align-items: center; }
${DEMO_VIEW_FRAME_SELECTOR} { width: ${DEMO_VIEW_WIDTH}px !important; height: 100vh !important; }
${DEMO_VIEW_FRAME_SELECTOR}:not(:last-of-type) { display: none !important; }
`;
}

export interface WindowReading {
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
  screenX: number;
  screenY: number;
}

const TOLERANCE_PX = 3;

// Why the window is not the recorded frame, or undefined when it is: x11grab records the X screen's top-left WxH device pixels.
export function frameMismatch(window: WindowReading, frame: { width: number; height: number }): string | undefined {
  const width = Math.round(window.innerWidth * window.devicePixelRatio);
  const height = Math.round(window.innerHeight * window.devicePixelRatio);
  if (Math.abs(window.devicePixelRatio - DEMO_SCALE) > 0.01) return `the page's scale is ${window.devicePixelRatio}, not ${DEMO_SCALE}`;
  if (Math.abs(width - frame.width) > TOLERANCE_PX || Math.abs(height - frame.height) > TOLERANCE_PX) return `${width}x${height} device pixels, not the ${frame.width}x${frame.height} frame`;
  if (Math.abs(window.screenX) > TOLERANCE_PX || Math.abs(window.screenY) > TOLERANCE_PX) return `at ${window.screenX},${window.screenY}, not 0,0`;
  return undefined;
}
