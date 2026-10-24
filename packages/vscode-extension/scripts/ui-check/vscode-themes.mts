// The theme variables VS Code gives a webview, for the UI check (step 10.11):
// Dark Modern, Light Modern and High Contrast, the colours the extension's
// theme-vscode.css maps onto. Only the variables theme-vscode.css and the web
// app read, plus the default webview body styles VS Code injects (its 20 px
// side padding is part of the width the panel really has).

export interface VscodeTheme {
  bodyClass: "vscode-dark" | "vscode-light" | "vscode-high-contrast";
  vars: Record<string, string>;
}

const FONT = {
  "--vscode-font-family": "-apple-system, BlinkMacSystemFont, 'Segoe WPC', 'Segoe UI', system-ui, Ubuntu, 'Droid Sans', sans-serif",
  "--vscode-font-size": "13px",
  "--vscode-font-weight": "normal",
  "--vscode-editor-font-family": "Consolas, 'Courier New', monospace",
  "--vscode-editor-font-size": "14px",
};

export const VSCODE_THEMES: Record<"dark" | "light" | "hc", VscodeTheme> = {
  dark: {
    bodyClass: "vscode-dark",
    vars: {
      ...FONT,
      "--vscode-editor-background": "#1f1f1f",
      "--vscode-editor-foreground": "#cccccc",
      "--vscode-foreground": "#cccccc",
      "--vscode-input-background": "#313131",
      "--vscode-input-border": "#3c3c3c",
      "--vscode-input-foreground": "#cccccc",
      "--vscode-panel-border": "#2b2b2b",
      "--vscode-button-background": "#0078d4",
      "--vscode-button-foreground": "#ffffff",
      "--vscode-button-hoverBackground": "#026ec1",
      "--vscode-descriptionForeground": "#9d9d9d",
      "--vscode-textLink-foreground": "#4daafc",
      "--vscode-focusBorder": "#0078d4",
      "--vscode-list-activeSelectionBackground": "#04395e",
      "--vscode-list-activeSelectionForeground": "#ffffff",
      "--vscode-errorForeground": "#f85149",
      "--vscode-sideBar-background": "#181818",
      "--vscode-textCodeBlock-background": "#2b2b2b",
    },
  },
  light: {
    bodyClass: "vscode-light",
    vars: {
      ...FONT,
      "--vscode-editor-background": "#ffffff",
      "--vscode-editor-foreground": "#3b3b3b",
      "--vscode-foreground": "#3b3b3b",
      "--vscode-input-background": "#ffffff",
      "--vscode-input-border": "#cecece",
      "--vscode-input-foreground": "#3b3b3b",
      "--vscode-panel-border": "#e5e5e5",
      "--vscode-button-background": "#005fb8",
      "--vscode-button-foreground": "#ffffff",
      "--vscode-button-hoverBackground": "#0258a8",
      "--vscode-descriptionForeground": "#3b3b3b",
      "--vscode-textLink-foreground": "#005fb8",
      "--vscode-focusBorder": "#005fb8",
      "--vscode-list-activeSelectionBackground": "#e8e8e8",
      "--vscode-list-activeSelectionForeground": "#000000",
      "--vscode-errorForeground": "#f85149",
      "--vscode-sideBar-background": "#f8f8f8",
      "--vscode-textCodeBlock-background": "#f8f8f8",
    },
  },
  hc: {
    bodyClass: "vscode-high-contrast",
    vars: {
      ...FONT,
      "--vscode-editor-background": "#000000",
      "--vscode-editor-foreground": "#ffffff",
      "--vscode-foreground": "#ffffff",
      "--vscode-input-background": "#000000",
      "--vscode-input-border": "#6fc3df",
      "--vscode-input-foreground": "#ffffff",
      "--vscode-panel-border": "#6fc3df",
      "--vscode-contrastBorder": "#6fc3df",
      "--vscode-contrastActiveBorder": "#f38518",
      "--vscode-button-background": "#000000",
      "--vscode-button-foreground": "#ffffff",
      "--vscode-descriptionForeground": "#ffffff",
      "--vscode-textLink-foreground": "#21a6ff",
      "--vscode-focusBorder": "#f38518",
      "--vscode-list-activeSelectionBackground": "#000000",
      "--vscode-list-activeSelectionForeground": "#ffffff",
      "--vscode-errorForeground": "#f48771",
    },
  },
};

// The <style> VS Code puts in every webview, with the theme's variables.
export function webviewDefaultCss(theme: VscodeTheme): string {
  const vars = Object.entries(theme.vars)
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");
  return [
    `:root { ${vars} }`,
    "html { background: var(--vscode-editor-background); }",
    "body { background-color: transparent; color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family);",
    "  font-weight: var(--vscode-font-weight); font-size: var(--vscode-font-size); margin: 0; padding: 0 20px; }",
  ].join("\n");
}
