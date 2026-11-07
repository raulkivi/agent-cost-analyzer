// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { AppHostPort, Unsubscribe } from "../host/app-host-port.js";

// What the views need from ext-apps' document helpers (DIP): main.tsx passes
// the real applyDocumentTheme, applyHostStyleVariables and applyHostFonts.
// Method syntax keeps the parameter bivariant, so ext-apps' narrower key
// types are accepted.
export interface ThemeApplier {
  applyDocumentTheme(theme: "light" | "dark"): void;
  applyHostStyleVariables(variables: Record<string, string | undefined>): void;
  applyHostFonts(css: string): void;
}

// Marks the document as an MCP App (theme-mcp-host.css is scoped to
// html[data-host="mcp-app"]) and applies each host context to it: the theme
// sets html[data-theme], which switches brand.css, and the host's variables
// and fonts feed theme-mcp-host.css. A context may carry any subset.
export function bindHostTheme(port: AppHostPort, applier: ThemeApplier, root: HTMLElement = document.documentElement): Unsubscribe {
  root.setAttribute("data-host", "mcp-app");
  return port.onHostContext((context) => {
    if (context.theme) applier.applyDocumentTheme(context.theme);
    if (context.styles?.variables) applier.applyHostStyleVariables(context.styles.variables);
    if (context.styles?.css?.fonts) applier.applyHostFonts(context.styles.css.fonts);
  });
}
