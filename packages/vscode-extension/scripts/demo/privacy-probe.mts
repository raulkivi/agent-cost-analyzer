// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Detects owner-private strings (names, emails, paths) in text about to appear in a recording.

const MIN_TERM_LENGTH = 3;

export function parseForbidden(value: string | undefined): string[] {
  const terms = (value ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");
  // A 1-2 character term would match almost any text and make the probe useless.
  const tooShort = terms.find((t) => t.length < MIN_TERM_LENGTH);
  if (tooShort !== undefined) {
    throw new Error(`DEMO_FORBIDDEN term "${tooShort}" is shorter than ${MIN_TERM_LENGTH} characters`);
  }
  return terms;
}

export function findForbidden(
  texts: { source: string; text: string }[],
  forbidden: string[],
): { source: string; match: string }[] {
  const terms = [...new Set(forbidden.map((t) => t.toLowerCase()))];
  const hits: { source: string; match: string }[] = [];
  for (const { source, text } of texts) {
    const haystack = text.toLowerCase();
    for (const term of terms) {
      if (haystack.includes(term)) hits.push({ source, match: term });
    }
  }
  return hits;
}
