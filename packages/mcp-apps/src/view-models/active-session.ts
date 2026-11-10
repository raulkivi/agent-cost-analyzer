// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { ACTIVE_SESSION_WINDOW_MINUTES } from "@agent-cost-analyzer/domain";

// The server decides whether a session is active (plan §4.7); the views only
// show its flag, so they stay deterministic and never read a clock.

export const ACTIVE_HINT = `Latest turn started in the last ${ACTIVE_SESSION_WINDOW_MINUTES} minutes; figures may still change`;
export const ACTIVE_NOTE = "Active session: figures may still change; the latest turn may be incomplete.";

export interface ActiveView {
  active: boolean;
  activeHint?: string; // tooltip for the "active" tag; present only when active
}

export function activeView(flag: boolean | undefined): ActiveView {
  return flag === true ? { active: true, activeHint: ACTIVE_HINT } : { active: false };
}
