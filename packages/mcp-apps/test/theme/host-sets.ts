// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Theme } from "./css-vars.js";
import { hostPalette, parseRecordedColours } from "./vscode-theme-recording.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");

export const THEME_CSS = readFileSync(path.join(repoRoot, "packages/web/src/theme.css"), "utf8");
export const BRAND_CSS = readFileSync(path.join(here, "../../src/theme/brand.css"), "utf8");
export const HOST_CSS = readFileSync(path.join(here, "../../src/theme/theme-mcp-host.css"), "utf8");
// Cascade order of the views entry: theme.css, brand.css, theme-mcp-host.css.
export const SHEETS = [THEME_CSS, BRAND_CSS, HOST_CSS];

// A host as the page sees it: the theme applyDocumentTheme sets and the
// variables applyHostStyleVariables puts on <html>.
export interface HostSet {
  name: string;
  theme: Theme;
  hostVars: Record<string, string>;
}

interface SpikeReport {
  theme: { appliedToDocument: Theme };
  styleVariables: { count: number; defined: Record<string, string> };
}

function recorded(file: string): SpikeReport {
  return JSON.parse(readFileSync(path.join(repoRoot, "docs/plans/mcp-apps-spike-results", file), "utf8")) as SpikeReport;
}

// Claude Desktop sends concrete light-dark() values, the same pairs in a
// light and a dark session (A0 recordings); the document theme picks the branch.
export const CLAUDE_SETS: HostSet[] = ["light", "dark"].map((mode) => {
  const report = recorded(`claude-${mode}.json`);
  return { name: `Claude ${mode} (recorded)`, theme: report.theme.appliedToDocument, hostVars: report.styleVariables.defined };
});

// VS Code sends var(--vscode-*) references, which the webview resolves
// against the active theme. The A0 reports record the references only, so
// they are resolved here against VS Code's built-in Light Modern and Dark
// Modern colours, the values the approved A0b boards use
// (docs/plans/mockups/mcp-apps/README.md), and against the recorded Dark and
// Light High Contrast themes below. testing.iconPassed (the host's success
// colour, U11's fall) is #73c991 in both Light and Dark Modern: VS Code's
// default, which A33's run in VS Code 1.146 measured (U12's and U13's fall
// text at 2.9:1 on Light Modern). The A0b boards drew #388a34 for Light Modern.
const VSCODE_PALETTES: Record<string, Record<string, string>> = {
  "vscode-light": {
    "--vscode-foreground": "#3b3b3b",
    "--vscode-descriptionForeground": "#616161",
    "--vscode-editor-background": "#ffffff",
    "--vscode-sideBar-background": "#f8f8f8",
    "--vscode-activityBar-background": "#f8f8f8",
    "--vscode-widget-border": "#e5e5e5",
    "--vscode-textLink-foreground": "#005fb8",
    "--vscode-errorForeground": "#f85149",
    "--vscode-editorWarning-foreground": "#bf8803",
    "--vscode-testing-iconPassed": "#73c991",
    "--vscode-focusBorder": "#005fb8",
  },
  "vscode-dark": {
    "--vscode-foreground": "#cccccc",
    "--vscode-descriptionForeground": "#9d9d9d",
    "--vscode-editor-background": "#1f1f1f",
    "--vscode-sideBar-background": "#181818",
    "--vscode-activityBar-background": "#181818",
    "--vscode-widget-border": "#313131",
    "--vscode-textLink-foreground": "#4daafc",
    "--vscode-errorForeground": "#f85149",
    "--vscode-editorWarning-foreground": "#cca700",
    "--vscode-testing-iconPassed": "#73c991",
    "--vscode-focusBorder": "#0078d4",
  },
};

interface VscodeSetSource {
  label: string;
  // The A0 report whose style-variable references and document theme the set uses.
  report: string;
  // Where the palette comes from: a recording of the theme, else the table above.
  recording?: string;
  palette?: string;
}

// The High Contrast palettes are recordings of VS Code's own resolved colours
// (A24 1.7a, `npm run record:host-themes`), not defaults. The A0 style-variable
// references were recorded for Dark High Contrast only; Light High Contrast uses
// the Light Modern report (document theme "light"), assuming VS Code maps the
// same --vscode-* references in every theme and only the colours differ.
const VSCODE_SOURCES: VscodeSetSource[] = [
  { label: "VS Code Light Modern", report: "vscode-light.json", palette: "vscode-light" },
  { label: "VS Code Dark Modern", report: "vscode-dark.json", palette: "vscode-dark" },
  { label: "VS Code Dark High Contrast", report: "vscode-hc-dark.json", recording: "vscode-hc-dark-theme.jsonc" },
  { label: "VS Code Light High Contrast", report: "vscode-light.json", recording: "vscode-hc-light-theme.jsonc" },
];

function recordedPalette(file: string): Record<string, string> {
  return hostPalette(parseRecordedColours(readFileSync(path.join(repoRoot, "docs/plans/mcp-apps-a24-results", file), "utf8")));
}

export const VSCODE_SETS: HostSet[] = VSCODE_SOURCES.map((source) => {
  const report = recorded(source.report);
  const palette = source.recording !== undefined ? recordedPalette(source.recording) : VSCODE_PALETTES[source.palette!]!;
  return {
    name: `${source.label} (recorded references, resolved)`,
    theme: report.theme.appliedToDocument,
    hostVars: { ...palette, ...report.styleVariables.defined },
  };
});

// A host that sends no variables at all: every token takes its fallback.
export const FALLBACK_SETS: HostSet[] = (["light", "dark"] as const).map((theme) => ({ name: `No host variables, ${theme}`, theme, hostVars: {} }));
