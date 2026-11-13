// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Scene-only helpers for E6 (trends) and E8 (tool audit): workbench elements the page
// objects don't expose, found the way a viewer sees them (by visible text).
import { browser } from "@wdio/globals";
import { wdioVscodeHost as host } from "../../support/vscode-host.js";
import { enterWebview, leaveWebview } from "../../support/webview-frame.js";

// A Sessions row (a `.monaco-list-row` whose text contains `text`), once it is in the DOM.
export async function sessionRow(text: string): Promise<WebdriverIO.Element> {
  const row = await browser.$(`//div[contains(concat(' ',@class,' '),' monaco-list-row ')][contains(normalize-space(.),'${text}')]`);
  await row.waitForExist({ timeout: 30_000, timeoutMsg: `no Sessions row containing "${text}"` });
  return row;
}

// Opens the row's context menu the way a right-click does: the DOM `contextmenu` event,
// which VS Code's list listens for (a native right-click is flaky under Xvfb).
export async function openContextMenu(row: WebdriverIO.Element): Promise<void> {
  await row.click({ button: "right" });
  const opened = await browser.$("//div[contains(@class,'monaco-menu')]").waitForExist({ timeout: 2_000 }).then(() => true, () => false);
  if (opened) return;
  // Under Xvfb the driver's right-click sometimes doesn't reach the list: send the event itself.
  await browser.execute((e: HTMLElement) => {
    const box = e.getBoundingClientRect();
    e.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: box.x + 40, clientY: box.y + box.height / 2 }));
  }, row as never);
}

// A visible item of an open context menu.
export async function menuItem(label: string): Promise<WebdriverIO.Element> {
  const item = await browser.$(`//div[contains(@class,'monaco-menu')]//*[contains(@class,'action-label')][normalize-space(.)='${label}']`);
  await item.waitForExist({ timeout: 10_000, timeoutMsg: `no "${label}" item in the context menu` });
  return item;
}

export async function closeSidebar(): Promise<void> {
  await host.command("workbench.action.closeSidebar");
}

// The workbench document enforces Trusted Types, so the driver's overlay (which sets
// `innerHTML`) can't install itself there. Install the same overlay with the arrow built
// from DOM nodes; the driver then finds `window.__demoPointer` and skips its own install.
export async function installWorkbenchPointer(): Promise<void> {
  const { POINTER_OVERLAY_SCRIPT } = await import("../../../../scripts/demo/pointer-overlay.mts");
  const safe = POINTER_OVERLAY_SCRIPT.replace(
    /pointer\.innerHTML = arrow;/,
    `var svgNs = "http://www.w3.org/2000/svg";
  var svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("width", "24"); svg.setAttribute("height", "24"); svg.setAttribute("viewBox", "0 0 24 24");
  var arrowPath = document.createElementNS(svgNs, "path");
  arrowPath.setAttribute("d", "M2 2 L2 19 L6.5 14.8 L9.6 21.6 L12.4 20.4 L9.3 13.6 L15.5 13.4 Z");
  arrowPath.setAttribute("fill", "#ffffff"); arrowPath.setAttribute("stroke", "#1b1b1f");
  arrowPath.setAttribute("stroke-width", "1.6"); arrowPath.setAttribute("stroke-linejoin", "round");
  svg.appendChild(arrowPath); pointer.appendChild(svg);`,
  );
  await browser.switchFrame(null);
  await browser.execute(safe);
}

// The driver draws its pointer in the document it is in: the panel's webview document has
// its own overlay, the workbench another. Show one and hide the other, so a viewer never
// sees both (call before the next steps that point in `where`).
export async function showPointerIn(where: "workbench" | "webview"): Promise<void> {
  const display = (visible: boolean): Promise<void> =>
    browser.execute((shown: boolean) => {
      const pointer = document.getElementById("__demo-pointer");
      if (pointer) pointer.style.display = shown ? "" : "none";
    }, visible);
  await browser.switchFrame(null);
  await display(where === "workbench");
  const workbench = await browser.getWorkbench();
  const [webview] = await workbench.getAllWebviews();
  if (!webview) return;
  await enterWebview(browser, webview);
  try {
    await display(where === "webview");
  } finally {
    await leaveWebview(browser);
  }
}

// The analyzer's status bar item (today's AI Credits, with the repository's name).
export async function analyzerStatusItem(): Promise<WebdriverIO.Element> {
  const item = await browser.$("//a[starts-with(@aria-label,'AI Credits today')]");
  await item.waitForExist({ timeout: 30_000, timeoutMsg: "no AI Credits status bar item" });
  return item;
}
