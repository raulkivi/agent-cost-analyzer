// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { HOST_PALETTE_KEYS, hostPalette, parseRecordedColours } from "./vscode-theme-recording.js";

// The shape "Developer: Generate Color Theme From Current Settings" writes:
// a colour equal to its default is commented out, one the theme sets is not,
// and an unresolved colour is null. The token colours follow the colours.
const RECORDING = `{
\t"$schema": "vscode://schemas/color-theme",
\t"type": "hcDark",
\t"colors": {
\t\t"editor.background": "#000000",
\t\t//"foreground": "#ffffff",
\t\t//"descriptionForeground": "#ffffffb3",
\t\t//"widget.border": "#6fc3df",
\t\t"badge.background": "#00000000",
\t\t//"diffEditor.insertedTextBackground": null,
\t},
\t"tokenColors": [
\t\t{
\t\t\t"scope": ["comment"],
\t\t\t"settings": { "foreground": "#7ca668" }
\t\t},
\t]
}
`;

describe("parseRecordedColours", () => {
  const colours = parseRecordedColours(RECORDING);

  it("reads set colours and commented-out defaults alike", () => {
    expect(colours["editor.background"]).toBe("#000000");
    expect(colours.foreground).toBe("#ffffff");
    expect(colours["widget.border"]).toBe("#6fc3df");
  });

  it("leaves out unresolved (null) colours and the token colours", () => {
    expect(colours).not.toHaveProperty("diffEditor.insertedTextBackground");
    expect(Object.keys(colours)).toHaveLength(5);
  });

  it("rejects a text with no colours block", () => {
    expect(() => parseRecordedColours("{}")).toThrow(/colors/);
  });
});

describe("hostPalette", () => {
  const all = Object.fromEntries(HOST_PALETTE_KEYS.map((key) => [key, "#123456"]));

  it("names each colour as the webview's --vscode-* variable (dots become dashes)", () => {
    const palette = hostPalette({ ...all, "testing.iconPassed": "#73c991" });
    expect(palette["--vscode-testing-iconPassed"]).toBe("#73c991");
    expect(palette["--vscode-editor-background"]).toBe("#123456");
    expect(Object.keys(palette)).toHaveLength(HOST_PALETTE_KEYS.length);
  });

  it("writes an alpha colour as a mix with transparent, a form the contrast reader resolves", () => {
    expect(hostPalette({ ...all, descriptionForeground: "#ffffffb3" })["--vscode-descriptionForeground"]).toBe("color-mix(in srgb, #ffffff 70.2%, transparent)");
    expect(hostPalette({ ...all, descriptionForeground: "#112233ff" })["--vscode-descriptionForeground"]).toBe("#112233");
  });

  it("names a colour the recording lacks", () => {
    const rest = { ...all };
    delete rest.focusBorder;
    expect(() => hostPalette(rest)).toThrow(/focusBorder/);
  });
});
