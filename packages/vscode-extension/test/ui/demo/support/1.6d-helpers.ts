// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Wdio glue for scenes E5 and E7 (task 1.6d); covered by the scenes' end-state assertions.
import { browser } from "@wdio/globals";
import { POINTER_OVERLAY_SCRIPT } from "../../../../scripts/demo/pointer-overlay.mts";
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

// The workbench document refuses the pointer overlay's `innerHTML = "<svg...>"` (Trusted Types),
// which only works for scenes that reach the overlay from a webview. A scene that never enters
// one installs the overlay here first: the overlay's first element gets an innerHTML that builds
// the same arrow with createElementNS (DOMParser is also refused); the driver then finds it installed.
export async function installPointerOverlay(): Promise<void> {
  await inTopContext();
  await browser.execute(`(function () {
    var original = document.createElement;
    var created = 0;
    document.createElement = function () {
      var element = original.apply(document, arguments);
      if (created++ === 0) {
        Object.defineProperty(element, "innerHTML", {
          set: function () {
            var ns = "http://www.w3.org/2000/svg";
            var svg = document.createElementNS(ns, "svg");
            svg.setAttribute("width", "24");
            svg.setAttribute("height", "24");
            svg.setAttribute("viewBox", "0 0 24 24");
            var path = document.createElementNS(ns, "path");
            path.setAttribute("d", "M2 2 L2 19 L6.5 14.8 L9.6 21.6 L12.4 20.4 L9.3 13.6 L15.5 13.4 Z");
            path.setAttribute("fill", "#ffffff");
            path.setAttribute("stroke", "#1b1b1f");
            path.setAttribute("stroke-width", "1.6");
            path.setAttribute("stroke-linejoin", "round");
            svg.appendChild(path);
            element.appendChild(svg);
          },
        });
      }
      return element;
    };
    try {
      ${POINTER_OVERLAY_SCRIPT}
    } finally {
      document.createElement = original;
    }
  })()`);
}

// A DOM click does not move focus; typing needs it.
export async function clickAndFocus(driver: DemoDriver, selector: string): Promise<void> {
  await inTopContext();
  const element = await (await browser.$(selector)).getElement();
  await driver.click(element);
  await browser.execute((target: HTMLElement) => target.focus(), element as never);
}
