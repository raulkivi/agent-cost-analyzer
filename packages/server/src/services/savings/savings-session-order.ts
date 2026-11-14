// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SavingsSessionRef } from "@agent-cost-analyzer/domain";

// D16: an opportunity's sessions, the largest contribution to its saving
// first, so a view or a tool that shows the first few shows the largest.
// `high` is the session's own priced high end; a session that could not be
// priced has none and goes last. Equal figures keep the detector's order.
export function sessionsByContribution(entries: readonly { ref: SavingsSessionRef; high: number | undefined }[]): SavingsSessionRef[] {
  return entries
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => (b.high ?? -1) - (a.high ?? -1) || a.index - b.index)
    .map((entry) => entry.ref);
}
