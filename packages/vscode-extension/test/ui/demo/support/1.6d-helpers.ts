// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Wdio glue for scenes E5 and E7 (task 1.6d); covered by the scenes' end-state assertions.
import { browser } from "@wdio/globals";
import type { DemoDriver } from "./demo-driver.ts";

// Glides to a webview <select>, then sets it the way a pick would (native popups are not recorded).
export async function chooseSelectValue(driver: DemoDriver, selectSelector: string, value: string): Promise<void> {
  const select = await (await browser.$(selectSelector)).getElement();
  await driver.pointerTo(select);
  await browser.execute(
    (element: HTMLSelectElement, next: string) => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(element, next);
      element.dispatchEvent(new Event("change", { bubbles: true }));
    },
    select as never,
    value,
  );
}

export async function inTopContext(): Promise<void> {
  await browser.switchFrame(null);
}

// A DOM click does not move focus; typing needs it.
export async function clickAndFocus(driver: DemoDriver, selector: string): Promise<void> {
  await inTopContext();
  const element = await (await browser.$(selector)).getElement();
  await driver.click(element);
  await browser.execute((target: HTMLElement) => target.focus(), element as never);
}
