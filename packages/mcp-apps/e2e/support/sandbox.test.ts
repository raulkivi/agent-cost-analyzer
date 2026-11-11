// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { HOST_PAGE_URL, requestTarget, VIEW_URL, viewCsp, withWebviewVariables } from "./sandbox.js";

describe("requestTarget", () => {
  it("serves the host page and the view from their own origins, and nothing else", () => {
    expect(requestTarget(HOST_PAGE_URL)).toBe("host-page");
    expect(requestTarget(VIEW_URL)).toBe("view");
    expect(requestTarget("https://assets.claude.ai/Fonts/AnthropicSans-Text-Regular-Static.otf")).toBe("blocked");
    expect(requestTarget(`${HOST_PAGE_URL}favicon.ico`)).toBe("blocked");
  });

  it("puts the host and the view on different origins, as a host's sandbox does", () => {
    expect(new URL(HOST_PAGE_URL).origin).not.toBe(new URL(VIEW_URL).origin);
  });
});

describe("withWebviewVariables", () => {
  const HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8" /></head><body></body></html>';

  it("defines the variables on the view's root first thing in its head, as a VS Code webview does", () => {
    expect(withWebviewVariables(HTML, { "--vscode-foreground": "#cccccc", "--vscode-focusBorder": "#0078d4" })).toBe(
      '<!doctype html><html lang="en"><head><style id="webview-variables">html { --vscode-foreground: #cccccc; --vscode-focusBorder: #0078d4; }</style><meta charset="utf-8" /></head><body></body></html>',
    );
  });

  it("leaves the view as it is when there are none", () => {
    expect(withWebviewVariables(HTML, {})).toBe(HTML);
  });

  it("refuses a name or value that could leave the style element", () => {
    expect(() => withWebviewVariables(HTML, { "--vscode-x": "red; } </style><script>" })).toThrow(/not a plain CSS value/);
    expect(() => withWebviewVariables(HTML, { "x</style>": "red" })).toThrow(/not a CSS custom property/);
  });
});

describe("viewCsp (MCP Apps spec: the host enforces the resource's declared domains)", () => {
  it("allows inline script and style and nothing from the network when the resource declares no domains", () => {
    const csp = viewCsp(undefined);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'unsafe-inline'");
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).not.toMatch(/https?:/);
  });

  it("adds declared domains to the directives they map to", () => {
    const csp = viewCsp({ connectDomains: ["https://api.example.com"], resourceDomains: ["https://cdn.example.com"] });
    expect(csp).toContain("connect-src https://api.example.com");
    expect(csp).toContain("script-src 'unsafe-inline' https://cdn.example.com");
    expect(csp).toContain("img-src data: https://cdn.example.com");
  });
});
