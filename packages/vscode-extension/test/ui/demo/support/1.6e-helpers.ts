// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Scene-only helpers for E6 (trends) and E8 (tool audit): workbench elements the page
// objects don't expose, found the way a viewer sees them (by visible text).
import { browser } from "@wdio/globals";

type PageElement = ReturnType<typeof browser.$>;
import { wdioVscodeHost as host } from "../../support/vscode-host.js";

// A Sessions row (a `.monaco-list-row` whose text contains `text`), once it is in the DOM.
export async function sessionRow(text: string): Promise<PageElement> {
  const row = await browser.$(`//div[contains(concat(' ',@class,' '),' monaco-list-row ')][contains(normalize-space(.),'${text}')]`);
  await row.waitForExist({ timeout: 30_000, timeoutMsg: `no Sessions row containing "${text}"` });
  return row;
}

// Opens the row's context menu the way a right-click does: the DOM `contextmenu` event,
// which VS Code's list listens for (a native right-click is flaky under Xvfb).
export async function openContextMenu(row: PageElement): Promise<void> {
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
export async function menuItem(label: string): Promise<PageElement> {
  const item = await browser.$(`//div[contains(@class,'monaco-menu')]//*[contains(@class,'action-label')][normalize-space(.)='${label}']`);
  await item.waitForExist({ timeout: 10_000, timeoutMsg: `no "${label}" item in the context menu` });
  return item;
}

export async function closeSidebar(): Promise<void> {
  await host.command("workbench.action.closeSidebar");
}

// The analyzer's status bar item (today's AI Credits, with the repository's name).
export async function analyzerStatusItem(): Promise<PageElement> {
  const item = await browser.$("//a[starts-with(@aria-label,'AI Credits today')]");
  await item.waitForExist({ timeout: 30_000, timeoutMsg: "no AI Credits status bar item" });
  return item;
}
