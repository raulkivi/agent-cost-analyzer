// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// Phase 14 step 14.7: the label on every simulated figure (plan §10's first
// over-trust mitigation). Words first; the flask icon and the dashed frame
// only repeat them, so no theme or colour vision can lose it.
export function SimulatedBadge() {
  return (
    <span className="sim-badge">
      <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 3h6M10 3v6l-5 10a1 1 0 0 0 1 1.5h12a1 1 0 0 0 1-1.5l-5-10V3" />
      </svg>
      Simulated
    </span>
  );
}
