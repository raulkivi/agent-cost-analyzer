// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { act, fireEvent } from "@testing-library/react";

// The dynamic half of the no-forwarding rule (A14, plan §6): presses every
// control a view shows, again and again until nothing new appears (a turn's
// detail brings "Hide turn", a failure brings "Retry"), so a view's security
// test covers all its controls, not the ones its author remembered. Returns
// the names of what it pressed, for the test to assert coverage.
//
// Buttons are clicked, every radio is picked, and every option of every
// select is chosen. A control is pressed once per name; `skip` leaves some
// out (a Back button that would leave the view under test).

const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const nameOf = (element: Element): string => (element.getAttribute("aria-label") ?? element.textContent ?? "").trim();

export async function exerciseEveryControl(root: ParentNode = document.body, options: { skip?: RegExp; rounds?: number } = {}): Promise<string[]> {
  const pressed: string[] = [];
  const seen = new Set<string>();
  for (let round = 0; round < (options.rounds ?? 8); round += 1) {
    let acted = false;
    // Let a call the last press started answer before looking again.
    await settle();
    const controls = [...root.querySelectorAll("button, input[type=radio], select")];
    for (const control of controls) {
      if (!control.isConnected) continue;
      if (control instanceof HTMLSelectElement) {
        for (const option of [...control.options]) {
          const key = `select:${control.name || nameOf(control.closest("label") ?? control)}=${option.value}`;
          if (seen.has(key) || !control.isConnected) continue;
          seen.add(key);
          fireEvent.change(control, { target: { value: option.value } });
          pressed.push(key);
          acted = true;
          await settle();
        }
        continue;
      }
      const name = control instanceof HTMLInputElement ? `radio:${nameOf(control.closest("label") ?? control)}` : `button:${nameOf(control)}`;
      if (seen.has(name) || options.skip?.test(name) || (control as HTMLButtonElement).disabled) continue;
      seen.add(name);
      fireEvent.click(control);
      pressed.push(name);
      acted = true;
      await settle();
    }
    if (!acted) break;
  }
  return pressed;
}
