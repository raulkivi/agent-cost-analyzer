// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useLayoutEffect } from "react";
import type { RefObject } from "react";

// When an in-place swap removes the control that had focus (a drill-down
// opening, Back closing it, a loading state giving way to the result), the
// browser drops focus to the document and a keyboard user starts again from
// the top. This puts focus on `ref` when it mounts, in the same commit (a
// layout effect: a passive one runs after paint, and an Enter pressed in that
// gap is lost), but only if focus was
// lost that way: it never takes focus from a control the user is on (A14).
export function focusIfLost(target: HTMLElement | null, doc: Document = document): void {
  const active = doc.activeElement;
  if (target !== null && (active === null || active === doc.body)) target.focus();
}

export function useFocusOnMountIfLost(ref: RefObject<HTMLElement | null>, enabled = true): void {
  useLayoutEffect(() => {
    if (enabled) focusIfLost(ref.current);
    // Mount only: a later render must not move focus.
  }, []);
}
