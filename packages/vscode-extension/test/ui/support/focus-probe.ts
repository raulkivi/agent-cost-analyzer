// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The computed style properties that make a focused element visibly focused.
export interface FocusStyle {
  outlineStyle: string;
  outlineWidth: string;
  boxShadow: string;
}

// Whether a focused element's computed style draws an outline or a box
// shadow (the two ways the webview's theme styles focus).
export function hasVisibleFocusIndicator(style: FocusStyle): boolean {
  const outlined = style.outlineStyle !== "none" && style.outlineStyle !== "hidden" && parseFloat(style.outlineWidth) > 0;
  const shadowed = style.boxShadow !== "" && style.boxShadow !== "none";
  return outlined || shadowed;
}
