// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { GENERIC_BRAND, type ViewBrand } from "./view-brand.js";

function parse(raw: string): ViewBrand | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.displayName !== "string" || v.displayName.trim() === "") return undefined;
  return {
    productId: v.productId === "vscode-extension" ? "vscode-extension" : "standalone",
    displayName: v.displayName,
    version: typeof v.version === "string" ? v.version : "",
    ...(typeof v.deepLinkBase === "string" && v.deepLinkBase !== "" ? { deepLinkBase: v.deepLinkBase } : {}),
  };
}

// Reads the brand the server injected into <meta name="aca-brand">. A
// missing, empty or malformed value degrades to the generic brand; the view
// never fails because of it.
export function readBrand(doc: Document): ViewBrand {
  const raw = doc.querySelector('meta[name="aca-brand"]')?.getAttribute("content") ?? "";
  if (raw.trim() === "") return GENERIC_BRAND;
  return parse(raw) ?? GENERIC_BRAND;
}
