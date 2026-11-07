// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { FindingSeverity } from "@agent-cost-analyzer/domain";

// Severity is a shape, a host semantic colour and the written word beside it
// (plan §5.4: never colour alone).
export function SeverityMark({ severity }: { severity: FindingSeverity }) {
  return (
    <svg className={`fv-mark fv-mark--${severity}`} aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
      {severity === "critical" && <path d="M6 0.8 L11.2 6 L6 11.2 L0.8 6z" />}
      {severity === "high" && <path d="M6 1 L11.2 10.6 L0.8 10.6z" />}
      {severity === "medium" && <circle cx="6" cy="6" r="4.6" />}
      {(severity === "low" || severity === "info") && <circle cx="6" cy="6" r="4.2" strokeWidth="1.6" fill="none" />}
    </svg>
  );
}
