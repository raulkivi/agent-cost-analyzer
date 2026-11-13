// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { MAX_SAVINGS_NAME_LENGTH } from "@agent-cost-analyzer/domain";
import { redactSecrets } from "../tool-audit/output-redactor.js";

// Phase 16 SR16 (savings-report.md §11, threat-model "log-derived names"): a
// tool, MCP server or program name comes from a log, so it may carry a
// secret, line breaks or bidi overrides. Every detector passes it through
// here before it becomes a subject or an action parameter.

export const UNNAMED = "(unnamed)";

// Control (Cc), format (Cf: bidi and zero-width) and separator characters.
const CONTROL_OR_SPACE_RUN = /[\p{Cc}\p{Cf}\p{Z}\s]+/gu;

// One line: control, bidi and zero-width characters become single spaces.
export function foldName(raw: string): string {
  return raw.replace(CONTROL_OR_SPACE_RUN, " ").trim();
}

export function savingsName(raw: string): string {
  const redacted = redactSecrets(foldName(raw)).trim();
  // Whole code points only, so a cap never leaves half a surrogate pair; the
  // schema's cap counts UTF-16 units.
  let capped = "";
  for (const character of redacted) {
    if (capped.length + character.length > MAX_SAVINGS_NAME_LENGTH) break;
    capped += character;
  }
  capped = capped.trim();
  return capped === "" ? UNNAMED : capped;
}
