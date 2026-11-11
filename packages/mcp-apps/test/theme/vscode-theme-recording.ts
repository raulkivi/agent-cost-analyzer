// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// Reads a recording of "Developer: Generate Color Theme From Current Settings"
// (docs/plans/mcp-apps-a24-results/vscode-hc-*-theme.jsonc, written by
// `npm run record:host-themes` in packages/vscode-extension) into the palette
// host-sets.ts resolves VS Code's var(--vscode-*) references against.

// The theme colours the host's style variables point at (the references in
// docs/plans/mcp-apps-spike-results/vscode-*.json that the tests resolve).
export const HOST_PALETTE_KEYS = [
  "foreground",
  "descriptionForeground",
  "editor.background",
  "sideBar.background",
  "activityBar.background",
  "widget.border",
  "textLink.foreground",
  "errorForeground",
  "editorWarning.foreground",
  "testing.iconPassed",
  "focusBorder",
] as const;

// A line of the colours block: `"key": "#hex",`, possibly commented out
// (VS Code comments out a colour that equals its default; it is still the
// colour in force). `null` (no value) doesn't match.
const COLOUR_LINE = /^\s*(?:\/\/)?"([^"]+)":\s*"(#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?)"\s*,?\s*$/;

export function parseRecordedColours(text: string): Record<string, string> {
  const start = text.indexOf('"colors"');
  if (start < 0) throw new Error('No "colors" block in the recorded theme');
  const end = text.indexOf('"tokenColors"', start);
  const colours: Record<string, string> = {};
  for (const line of text.slice(start, end < 0 ? undefined : end).split("\n")) {
    const match = COLOUR_LINE.exec(line);
    if (match && !(match[1]! in colours)) colours[match[1]!] = match[2]!.toLowerCase();
  }
  return colours;
}

// #rrggbbaa as the form the contrast reader resolves: a mix with transparent.
function asCssColour(hex: string): string {
  if (hex.length === 7) return hex;
  const alpha = parseInt(hex.slice(7), 16) / 255;
  return alpha >= 1 ? hex.slice(0, 7) : `color-mix(in srgb, ${hex.slice(0, 7)} ${+(alpha * 100).toFixed(2)}%, transparent)`;
}

export function hostPalette(colours: Record<string, string>): Record<string, string> {
  const palette: Record<string, string> = {};
  for (const key of HOST_PALETTE_KEYS) {
    const colour = colours[key];
    if (colour === undefined) throw new Error(`The recorded theme has no ${key} colour`);
    palette[`--vscode-${key.replaceAll(".", "-")}`] = asCssColour(colour);
  }
  return palette;
}
