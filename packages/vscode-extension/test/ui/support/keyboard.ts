// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Keyboard-only helpers for the panel's webview (check 1.7, step 10.16): press
// keys, and describe the focused element, with no mouse.
import { browser } from "@wdio/globals";
import { hasVisibleFocusIndicator, type FocusStyle } from "./focus-probe.js";

export interface FocusedElement extends FocusStyle {
  tag: string;
  // aria-label, else the text.
  name: string;
  role: string | null;
  ariaPressed: string | null;
  ariaExpanded: string | null;
}

export function focusedElement(): Promise<FocusedElement> {
  return browser.execute(() => {
    const element = document.activeElement as HTMLElement;
    const style = getComputedStyle(element);
    return {
      tag: element.tagName,
      // aria-label, else the label of a form control, else the text.
      name: (element.getAttribute("aria-label") ?? (element as HTMLInputElement).labels?.[0]?.textContent ?? element.textContent ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 80),
      role: element.getAttribute("role"),
      ariaPressed: element.getAttribute("aria-pressed"),
      ariaExpanded: element.getAttribute("aria-expanded"),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
    };
  });
}

export async function press(...keys: string[]): Promise<void> {
  await browser.keys(keys);
}

// Presses Tab until the focused element satisfies `matches`, checking that
// each element passed on the way shows a visible focus indicator. Returns
// every element visited, the match last.
export async function tabUntil(matches: (element: FocusedElement) => boolean, maxPresses = 60): Promise<FocusedElement[]> {
  const visited: FocusedElement[] = [];
  for (let presses = 0; presses < maxPresses; presses++) {
    await press("Tab");
    const element = await focusedElement();
    visited.push(element);
    if (element.tag !== "BODY" && !hasVisibleFocusIndicator(element)) {
      throw new Error(`No visible focus indicator on <${element.tag.toLowerCase()}> "${element.name}" (${JSON.stringify(element)})`);
    }
    if (matches(element)) return visited;
  }
  throw new Error(`Tab did not reach the wanted element in ${maxPresses} presses; visited: ${visited.map((element) => element.name).join(" > ")}`);
}
