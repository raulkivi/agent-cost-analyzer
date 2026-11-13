// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";

// The honesty tags of plan §7: "inferred", "estimate" (dashed) and "Simulated"
// (dashed, accent). The word carries the meaning; the dash and colour only
// repeat it.
export function SavingsLabel({ kind, children }: { kind: "dash" | "sim"; children: ReactNode }) {
  return <span className={kind === "sim" ? "savings-tag savings-tag--sim" : "savings-tag"}>{children}</span>;
}
