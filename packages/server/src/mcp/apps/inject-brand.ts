// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Fills the one <meta name="aca-brand" content=""> placeholder of an MCP App
// view's HTML with the product brand (MCP Apps plan §4.2). Pure.

import type { ViewBrand } from "./view-brand.js";

const PLACEHOLDER = '<meta name="aca-brand" content="">';

const ATTRIBUTE_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ATTRIBUTE_ESCAPES[c]!);
}

export function injectBrand(html: string, brand: ViewBrand): string {
  const first = html.indexOf(PLACEHOLDER);
  if (first === -1) throw new Error(`injectBrand: the HTML has no ${PLACEHOLDER} placeholder`);
  if (html.indexOf(PLACEHOLDER, first + PLACEHOLDER.length) !== -1) {
    throw new Error(`injectBrand: expected exactly one ${PLACEHOLDER} placeholder, found more than once`);
  }
  const filled = `<meta name="aca-brand" content="${escapeAttribute(JSON.stringify(brand))}">`;
  return html.slice(0, first) + filled + html.slice(first + PLACEHOLDER.length);
}
