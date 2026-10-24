import { useId, useRef } from "react";
import type { ReactNode } from "react";
import { useEscapeKey, useFocusReturn } from "../../lib/focus.js";

interface DrawerProps {
  title: string;
  onClose: () => void;
  // "side": over the right edge (the medium layout's right column);
  // "inline": a section below the table (the narrow layout, mock-up 4).
  placement?: "side" | "inline";
  children: ReactNode;
}

// A non-modal drawer (§3.5 Layout): a region named by its heading. It takes
// focus when it opens and gives it back on close; Escape closes it; Tab
// moves on past it, never trapped.
export function Drawer({ title, onClose, placement = "side", children }: DrawerProps) {
  const titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  useFocusReturn(closeButton);
  useEscapeKey(onClose);

  return (
    <section className={`drawer drawer--${placement}`} role="region" aria-labelledby={titleId}>
      <div className="drawer-header">
        <h2 id={titleId} className="drawer-title">
          {title}
        </h2>
        <button
          ref={closeButton}
          type="button"
          className="btn btn-ghost"
          aria-label="Close details"
          onClick={onClose}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      {children}
    </section>
  );
}
