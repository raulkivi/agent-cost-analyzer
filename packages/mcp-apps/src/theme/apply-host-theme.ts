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

// ext-apps' applyHostStyleVariables calls style.setProperty(key, value) on
// <html> for every entry it is given. The views read only custom properties
// (--*), so anything else is dropped: a plain property name would restyle
// the page itself, and a url(), image() or image-set() value would make a
// request (constraint 1; plan §6, A14). setProperty already rejects a value
// that tries to close the declaration (";", "}"), but those, "<", "@" and
// expression() are refused here too rather than relying on the parser.
const CUSTOM_PROPERTY = /^--[A-Za-z0-9_-]+$/;
const UNSAFE_VALUE = /url\(|image\(|image-set\(|expression\(|[;{}<>@\\]/i;

export function safeHostVariables(variables: Record<string, string | undefined>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [name, value] of Object.entries(variables)) {
    if (typeof value === "string" && CUSTOM_PROPERTY.test(name) && !UNSAFE_VALUE.test(value)) safe[name] = value;
  }
  return safe;
}

// Marks the document as an MCP App (theme-mcp-host.css is scoped to
// html[data-host="mcp-app"]) and applies each host context to it: the theme
// sets html[data-theme], which switches brand.css, and the host's variables
// and fonts feed theme-mcp-host.css. A context may carry any subset.
// The fonts CSS is the host's own @font-face rules (Claude Desktop's load
// from its own asset domain under the host's CSP); it is passed on as is.
export function bindHostTheme(port: AppHostPort, applier: ThemeApplier, root: HTMLElement = document.documentElement): Unsubscribe {
  root.setAttribute("data-host", "mcp-app");
  return port.onHostContext((context) => {
    if (context.theme === "light" || context.theme === "dark") applier.applyDocumentTheme(context.theme);
    if (context.styles?.variables) applier.applyHostStyleVariables(safeHostVariables(context.styles.variables));
    if (context.styles?.css?.fonts) applier.applyHostFonts(context.styles.css.fonts);
  });
}
