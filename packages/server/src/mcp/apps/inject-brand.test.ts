// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { injectBrand } from "./inject-brand.js";
import type { ViewBrand } from "./view-brand.js";

const PLACEHOLDER = '<meta name="aca-brand" content="">';
const brand: ViewBrand = { productId: "standalone", displayName: "Agent Cost Analyzer", version: "1.2.3" };

function readContent(html: string): string {
  const m = /<meta name="aca-brand" content="([^"]*)">/.exec(html);
  if (!m) throw new Error("no meta");
  return m[1]!
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

describe("injectBrand", () => {
  it("fills the placeholder with the brand as JSON", () => {
    const out = injectBrand("<head>" + PLACEHOLDER + "</head>", brand);
    expect(JSON.parse(readContent(out))).toEqual(brand);
    expect(out.startsWith("<head>")).toBe(true);
    expect(out.endsWith("</head>")).toBe(true);
  });

  it("includes deepLinkBase when given", () => {
    const b: ViewBrand = { ...brand, productId: "vscode-extension", deepLinkBase: "vscode://x.y" };
    expect(JSON.parse(readContent(injectBrand(PLACEHOLDER, b)))).toEqual(b);
  });

  it("escapes a display name that tries to leave the attribute", () => {
    const evil = { ...brand, displayName: "\"><script>alert(1)</script>'&" };
    const out = injectBrand("<head>" + PLACEHOLDER + "</head>", evil);
    expect(out).not.toContain("<script>");
    expect(out.match(/<meta /g)).toHaveLength(1);
    expect(JSON.parse(readContent(out)).displayName).toBe(evil.displayName);
  });

  it("is not fooled by replacement patterns in the brand", () => {
    const b = { ...brand, displayName: "$& $1 $`" };
    expect(JSON.parse(readContent(injectBrand(PLACEHOLDER, b))).displayName).toBe(b.displayName);
  });

  it("throws when the placeholder is missing", () => {
    expect(() => injectBrand("<head></head>", brand)).toThrow(/aca-brand/);
  });

  it("throws when the placeholder appears more than once", () => {
    expect(() => injectBrand(PLACEHOLDER + PLACEHOLDER, brand)).toThrow(/more than once|exactly one/i);
  });
});
