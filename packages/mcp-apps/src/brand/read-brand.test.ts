// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { readBrand } from "./read-brand.js";
import { GENERIC_BRAND } from "./view-brand.js";

function docWith(content: string | undefined): Document {
  const doc = document.implementation.createHTMLDocument("t");
  if (content !== undefined) {
    const meta = doc.createElement("meta");
    meta.setAttribute("name", "aca-brand");
    meta.setAttribute("content", content);
    doc.head.append(meta);
  }
  return doc;
}

describe("readBrand", () => {
  it("parses the injected ViewBrand JSON", () => {
    const brand = { productId: "vscode-extension", displayName: "AI Credits Analyzer", version: "0.9.0", deepLinkBase: "vscode://raulkivi.ai-credits-analyzer" };
    expect(readBrand(docWith(JSON.stringify(brand)))).toEqual(brand);
  });

  it("omits deepLinkBase when the standalone product has none", () => {
    const brand = { productId: "standalone", displayName: "Agent Cost Analyzer", version: "0.9.0" };
    expect(readBrand(docWith(JSON.stringify(brand)))).toEqual(brand);
  });

  it("degrades to the generic brand for a missing meta, an empty placeholder or bad JSON", () => {
    expect(readBrand(docWith(undefined))).toEqual(GENERIC_BRAND);
    expect(readBrand(docWith(""))).toEqual(GENERIC_BRAND);
    expect(readBrand(docWith("{not json"))).toEqual(GENERIC_BRAND);
    expect(readBrand(docWith("42"))).toEqual(GENERIC_BRAND);
    expect(readBrand(docWith(JSON.stringify({ displayName: "" })))).toEqual(GENERIC_BRAND);
  });

  it("has a generic name", () => {
    expect(GENERIC_BRAND.displayName).not.toBe("");
  });
});
