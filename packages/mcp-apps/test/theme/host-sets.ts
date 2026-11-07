// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Theme } from "./css-vars.js";

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
// they are resolved here against VS Code's built-in Light Modern, Dark Modern
// and Dark High Contrast colours, the values the approved A0b boards use
// (docs/plans/mockups/mcp-apps/README.md). Light High Contrast was not
// recorded, so it is not listed.
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
    "--vscode-focusBorder": "#0078d4",
  },
  "vscode-hc-dark": {
    "--vscode-foreground": "#ffffff",
    "--vscode-descriptionForeground": "#ffffff",
    "--vscode-editor-background": "#000000",
    "--vscode-sideBar-background": "#000000",
    "--vscode-activityBar-background": "#000000",
    "--vscode-widget-border": "#6fc3df",
    "--vscode-textLink-foreground": "#21a6ff",
    "--vscode-errorForeground": "#f48771",
    "--vscode-editorWarning-foreground": "#ffd370",
    "--vscode-focusBorder": "#f38518",
  },
};

const VSCODE_LABELS: Record<string, string> = {
  "vscode-light": "VS Code Light Modern",
  "vscode-dark": "VS Code Dark Modern",
  "vscode-hc-dark": "VS Code Dark High Contrast",
};

export const VSCODE_SETS: HostSet[] = Object.entries(VSCODE_PALETTES).map(([file, palette]) => {
  const report = recorded(`${file}.json`);
  return {
    name: `${VSCODE_LABELS[file]} (recorded references, resolved)`,
    theme: report.theme.appliedToDocument,
    hostVars: { ...palette, ...report.styleVariables.defined },
  };
});

// A host that sends no variables at all: every token takes its fallback.
export const FALLBACK_SETS: HostSet[] = (["light", "dark"] as const).map((theme) => ({ name: `No host variables, ${theme}`, theme, hostVars: {} }));
