import { useEffect, useRef } from "react";
import type { RefObject } from "react";

// Keyboard and focus rules from vscode-extension.md §3.5 Accessibility:
// Escape closes the inspectors, drawers and dialogs; focus is never lost or
// trapped, except inside an open modal dialog, and goes back where it came
// from when a view closes.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Calls `onEscape` for an Escape pressed anywhere in the page, unless a
// control inside already handled it (stopped it, as the column chooser does
// when it closes itself first).
export function useEscapeKey(onEscape: () => void, enabled = true): void {
  const latest = useRef(onEscape);
  useEffect(() => {
    latest.current = onEscape;
  });
  useEffect(() => {
    if (!enabled) return;
    function handle(event: KeyboardEvent): void {
      if (event.key === "Escape" && !event.defaultPrevented) {
        latest.current();
      }
    }
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [enabled]);
}

function focusOpenerOnClose(opener: Element | null): void {
  if (opener instanceof HTMLElement && opener.isConnected) {
    opener.focus();
  }
}

// A view that replaces or overlays the page (an inspector, a drawer):
// focus moves to `initial` when it opens and back to whatever had it when
// it closes, if that's still on the page.
export function useFocusReturn(initial: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const opener = document.activeElement;
    initial.current?.focus();
    return () => focusOpenerOnClose(opener);
    // Once per open view.
  }, []);
}

// A modal dialog: focus starts on its first control, Tab and Shift+Tab
// cycle inside it while it's open, and focus returns to the opener on close.
export function useFocusTrap(container: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const opener = document.activeElement;
    const element = container.current;
    if (!element) return;
    const focusables = () => Array.from(element.querySelectorAll<HTMLElement>(FOCUSABLE));
    focusables()[0]?.focus();

    function handle(event: KeyboardEvent): void {
      if (event.key !== "Tab") return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    element.addEventListener("keydown", handle);
    return () => {
      element.removeEventListener("keydown", handle);
      focusOpenerOnClose(opener);
    };
    // Once per open dialog.
  }, []);
}
