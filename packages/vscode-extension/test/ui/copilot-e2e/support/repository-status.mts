// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Reads the figures check 1.14 asserts on off the analyzer's own UI text
// (step 10.17 G7): the status bar item's accessible name and a Sessions group's
// description. Formats: status-bar-model.ts and sessions-tree-model.ts.

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "AI Credits today: 0.31 in demo, 4.20 in all repositories, ..." gives 0.31
// for "demo"; null for another repository, none, or "unknown".
export function repositoryStatusCredits(items: string[], repositoryName: string): number | null {
  const pattern = new RegExp(`^AI Credits today: ([\\d.]+) in ${escape(repositoryName)}, `);
  for (const item of items) {
    const match = pattern.exec(item);
    if (match) return Number(match[1]);
  }
  return null;
}

// "12.40 · 1 unknown" gives 12.4; "2 unknown" (nothing known) gives null.
export function groupCredits(description: string): number | null {
  const match = /^(\d+\.\d+)/.exec(description);
  return match ? Number(match[1]) : null;
}
