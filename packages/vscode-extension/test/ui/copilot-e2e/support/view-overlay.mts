// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Which overlay webview shows the MCP App view of a chat placeholder (G4,
// step 10.17). VS Code 1.145 renders a tool call's view as a placeholder
// `.mcp-app-part > .mcp-app-webview` in the chat list and lays a webview
// (`.webview-overlay-content > iframe.webview`, outside the chat's DOM) over
// it; nothing in the DOM links the two, so the overlay is the one that
// covers the placeholder.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlap(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

export function overlayOver(placeholder: Rect, overlays: readonly { id: string; rect: Rect }[]): string | undefined {
  let best: { id: string; area: number } | undefined;
  for (const overlay of overlays) {
    const area = overlap(placeholder, overlay.rect);
    if (area > 0 && (best === undefined || area > best.area)) best = { id: overlay.id, area };
  }
  return best?.id;
}
