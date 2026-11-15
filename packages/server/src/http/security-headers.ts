// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import type { RequestHandler } from "express";

// Inline scripts only: a `<script src>` is loaded from 'self' and needs no hash.
const INLINE_SCRIPT = /<script(?![^>]*\ssrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

/**
 * CSP source expressions for the inline scripts of a page (npm-package.md
 * §4.4). The built web app has one: the colour-mode boot script in
 * index.html. A hash allows exactly that text and keeps script-src free of
 * 'unsafe-inline'.
 */
export function inlineScriptHashes(html: string): string[] {
  return [...html.matchAll(INLINE_SCRIPT)]
    .map((match) => match[1] ?? "")
    .filter((body) => body.trim().length > 0)
    .map((body) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`);
}

/**
 * Everything may come from this origin only (fonts are bundled, constraint
 * 1; the app makes no remote request). Styles need no relaxation: React sets
 * them through the DOM, which a CSP does not block.
 */
export function contentSecurityPolicy(inlineScriptSources: readonly string[] = []): string {
  return [
    "default-src 'self'",
    ["script-src 'self'", ...inlineScriptSources].join(" "),
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function createSecurityHeaders(policy: string): RequestHandler {
  return (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", policy);
    next();
  };
}
