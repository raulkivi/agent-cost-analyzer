// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { browser } from "@wdio/globals";

// Phase 16 SR15: reads and drives the Savings tab inside the panel's webview
// (call within `AnalyzerPanel.inside`). Specs get domain verbs, not selectors.
const WAIT_MS = 30_000;

export interface SavingsRowText {
  list: string;
  rank: string;
  title: string;
  subject: string;
  coverage: string;
  amount: string;
}

export interface SavingsScreen {
  rows: SavingsRowText[];
  lists: string[];
  notAnalysed: string[];
  text: string;
}

export async function waitForSavings(): Promise<void> {
  await browser.waitUntil(() => browser.execute(() => document.querySelectorAll("[data-testid='savings-row']").length > 0), {
    timeout: WAIT_MS,
    timeoutMsg: "the Savings tab listed no rows",
  });
}

export function readSavings(): Promise<SavingsScreen> {
  return browser.execute(() => {
    const text = (element: Element | null) => (element?.textContent ?? "").trim();
    const tab = document.querySelector("[data-testid='savings-tab']");
    const lists = Array.from(tab?.querySelectorAll("ul.savings-list") ?? []);
    const named = (list: Element) => list.getAttribute("aria-label") ?? "";
    return {
      lists: lists.map(named),
      rows: lists.flatMap((list) =>
        Array.from(list.querySelectorAll("[data-testid='savings-row']")).map((row) => ({
          list: named(list),
          rank: text(row.querySelector(".savings-rank")),
          title: text(row.querySelector(".savings-row-title")),
          subject: text(row.querySelector(".savings-subject-text")),
          coverage: text(row.querySelector(".savings-coverage")),
          amount: text(row.querySelector(".savings-amount-text")),
        })),
      ),
      notAnalysed: Array.from(tab?.querySelectorAll("ul[aria-label='Not analysed'] > li") ?? []).map((item) => (item.textContent ?? "").trim()),
      text: tab?.textContent ?? "",
    };
  });
}

export function hasProviderFilter(): Promise<boolean> {
  return browser.execute(() => Array.from(document.querySelectorAll("[data-testid='savings-tab'] label")).some((label) => (label.textContent ?? "").trim().startsWith("Provider")));
}

// Opens the nth savings row's detail.
export async function openRow(index: number): Promise<void> {
  const opened = await browser.execute((position) => {
    const button = document.querySelectorAll<HTMLButtonElement>("[data-testid='savings-row'] button")[position];
    button?.click();
    return button !== undefined;
  }, index);
  if (!opened) throw new Error(`No savings row ${index}`);
  await browser.waitUntil(() => browser.execute(() => document.querySelector("section[aria-label='Savings detail']") !== null), { timeout: WAIT_MS, timeoutMsg: "the detail did not open" });
}

export interface DetailScreen {
  text: string;
  action: string;
  closeLabel: string;
  sessionButtons: string[];
  versionsOpen: boolean | null;
  versionsSummary: string;
  status: string;
  listShown: boolean;
}

export function readDetail(): Promise<DetailScreen> {
  return browser.execute(() => {
    const detail = document.querySelector("section[aria-label='Savings detail']");
    const versions = detail?.querySelector("details");
    return {
      text: detail?.textContent ?? "",
      action: (detail?.querySelector(".savings-action")?.textContent ?? "").replace(/\s+/g, " ").trim(),
      closeLabel: (detail?.querySelector(".savings-close")?.textContent ?? "").trim(),
      sessionButtons: Array.from(detail?.querySelectorAll("button[aria-label]") ?? []).map((button) => button.getAttribute("aria-label") ?? ""),
      versionsOpen: versions ? versions.open : null,
      versionsSummary: (versions?.querySelector("summary")?.textContent ?? "").trim(),
      status: (detail?.querySelector("[role='status']")?.textContent ?? "").trim(),
      listShown: document.querySelector("ul.savings-list") !== null,
    };
  });
}

export async function clickDetailButton(label: string): Promise<void> {
  const clicked = await browser.execute((name) => {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>("section[aria-label='Savings detail'] button")).find((candidate) => (candidate.textContent ?? "").trim() === name);
    button?.click();
    return button !== undefined;
  }, label);
  if (!clicked) throw new Error(`No "${label}" button in the Savings detail`);
}

// The detail's own Copy text button takes focus, so Escape is sent from inside the detail.
export async function focusDetailButton(label: string): Promise<void> {
  await browser.execute((name) => {
    Array.from(document.querySelectorAll<HTMLButtonElement>("section[aria-label='Savings detail'] button")).find((candidate) => (candidate.textContent ?? "").trim() === name)?.focus();
  }, label);
}

export function focusedRowIndex(): Promise<number> {
  return browser.execute(() => Array.from(document.querySelectorAll("[data-testid='savings-row'] button")).indexOf(document.activeElement as Element));
}
