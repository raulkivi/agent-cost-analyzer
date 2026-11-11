// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { overlayOver } from "./view-overlay.mts";

// VS Code draws each MCP App view as an overlay webview laid over its
// placeholder in the chat (G4 spike): the overlay to enter is the one that
// covers the placeholder.
describe("overlayOver", () => {
  const placeholder = { x: 960, y: 100, width: 230, height: 300 };

  it("picks the overlay that covers the placeholder most", () => {
    const overlays = [
      { id: "a", rect: { x: 960, y: -250, width: 230, height: 300 } },
      { id: "b", rect: { x: 960, y: 102, width: 230, height: 296 } },
      { id: "c", rect: { x: 960, y: 380, width: 230, height: 300 } },
    ];

    expect(overlayOver(placeholder, overlays)).toBe("b");
  });

  it("finds none when no overlay touches the placeholder", () => {
    expect(overlayOver(placeholder, [{ id: "a", rect: { x: 0, y: 0, width: 100, height: 50 } }])).toBeUndefined();
  });

  it("ignores an overlay with no size (a hidden one)", () => {
    expect(overlayOver(placeholder, [{ id: "a", rect: { x: 960, y: 100, width: 0, height: 0 } }])).toBeUndefined();
  });
});
