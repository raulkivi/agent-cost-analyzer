// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { McpUiResourceCsp } from "@modelcontextprotocol/ext-apps/app-bridge";

// Where the fake host serves its page and the view (step 10.17 G5). Both
// are answered by Playwright's router from memory: .test never resolves,
// and every other request is refused and recorded, so nothing is loaded
// from the network. The view gets an origin of its own, as a host's
// sandbox gives it.
export const HOST_PAGE_URL = "http://host.mcp-apps.test/";
export const VIEW_URL = "http://sandbox.mcp-apps.test/views.html";

export type RequestTarget = "host-page" | "view" | "blocked";

export function requestTarget(url: string): RequestTarget {
  if (url === HOST_PAGE_URL) return "host-page";
  if (url === VIEW_URL) return "view";
  return "blocked";
}

// A VS Code host's view runs in a webview that already has VS Code's theme
// colours on its root; the host context's variables refer to them. The
// fake host serves the view with them defined first thing in its head.
export function withWebviewVariables(html: string, variables: Record<string, string>): string {
  const entries = Object.entries(variables);
  if (entries.length === 0) return html;
  for (const [name, value] of entries) {
    if (!/^--[A-Za-z0-9-]+$/.test(name)) throw new Error(`${name} is not a CSS custom property`);
    if (/[<>;{}]/.test(value)) throw new Error(`${name}: ${value} is not a plain CSS value`);
  }
  const style = `<style id="webview-variables">html { ${entries.map(([name, value]) => `${name}: ${value};`).join(" ")} }</style>`;
  return html.replace(/<head>/i, (head) => `${head}${style}`);
}

// The Content-Security-Policy the host puts on the view (MCP Apps spec,
// McpUiResourceCsp): inline script and style, and only the domains the
// resource declares. Ours declares none (mcp-apps.md §4.3).
export function viewCsp(csp: McpUiResourceCsp | undefined): string {
  const resources = (csp?.resourceDomains ?? []).map((domain) => ` ${domain}`).join("");
  const domains = (list: string[] | undefined, none = "'none'") => (list && list.length > 0 ? list.join(" ") : none);
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline'${resources}`,
    `style-src 'unsafe-inline'${resources}`,
    `img-src data:${resources}`,
    `font-src data:${resources}`,
    `media-src data:${resources}`,
    `connect-src ${domains(csp?.connectDomains)}`,
    `frame-src ${domains(csp?.frameDomains)}`,
    `base-uri ${domains(csp?.baseUriDomains, "'self'")}`,
  ].join("; ");
}
