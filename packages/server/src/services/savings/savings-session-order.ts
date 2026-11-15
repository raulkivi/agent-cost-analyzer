// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SavingsSessionRef } from "@agent-cost-analyzer/domain";

// D16: an opportunity's sessions, the largest contribution to its saving
// first, so a view or a tool that shows the first few shows the largest.
// The figure is the reference's own priced high end (V24); a session that
// could not be priced has none and goes last. Equal figures keep the
// detector's order.
const highOf = (ref: SavingsSessionRef): number => (ref.perWindow?.known === true ? ref.perWindow.high : -1);

export function sessionsByContribution(refs: readonly SavingsSessionRef[]): SavingsSessionRef[] {
  return refs
    .map((ref, index) => ({ ref, index }))
    .sort((a, b) => highOf(b.ref) - highOf(a.ref) || a.index - b.index)
    .map((entry) => entry.ref);
}
