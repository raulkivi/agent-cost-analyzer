// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useRef } from "react";
import type { DisplayMode } from "../../host/app-host-port.js";

// The fullscreen switch for U2 and U9. Its label says what a press does, and
// focus stays on it across the switch, so a keyboard user keeps their place.
export function FullscreenButton({ mode, onToggle }: { mode: DisplayMode; onToggle: () => Promise<void> }) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      className="btn btn-secondary view-btn"
      onClick={async () => {
        await onToggle();
        ref.current?.focus();
      }}
    >
      {mode === "fullscreen" ? "Exit fullscreen" : "Fullscreen"}
    </button>
  );
}
