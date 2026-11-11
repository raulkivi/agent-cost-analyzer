// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";
import "./replay.css";

// The check box under U12's title (board Replay): the own-model check in
// compare mode, the self-check in replay mode. A failed or missing check is a
// danger or warning box and an alert, never hidden (plan §4.5, §9.2 Q2); a
// passed one is a quiet note. The words carry the state; the icon and the
// colour only repeat them.

export type CalloutTone = "ok" | "warn" | "fail";

export function Callout({ tone, title, alert, children }: { tone: CalloutTone; title: string; alert: boolean; children: ReactNode }) {
  return (
    <div className={`rp-callout rp-callout--${tone}`} role={alert ? "alert" : undefined}>
      <svg className="rp-callout-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v6" />
        <path d="M12 16.5v.5" />
      </svg>
      <div>
        <span className="rp-callout-title">{title}</span> {children}
      </div>
    </div>
  );
}
