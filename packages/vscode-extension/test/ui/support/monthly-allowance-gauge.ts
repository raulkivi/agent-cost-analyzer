// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Reads the monthly allowance gauge (step 10.21) as drawn in the status bar,
// for the monthly allowance specs.
import { browser } from "@wdio/globals";

export const GAUGE_ITEM_ID = "raulkivi.ai-credits-analyzer.aiCreditsAnalyzer.monthlyAllowance";
export const ALLOWANCE_SETTING = "aiCreditsAnalyzer.monthlyAllowance.aiCredits";
export const RESET_DAY_SETTING = "aiCreditsAnalyzer.monthlyAllowance.resetDay";

export interface GaugeDom {
  text: string;
  classes: string[];
  background: string;
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

// "rgb(122, 100, 0)", "rgba(0, 0, 0, 0)" or "rgb(122 100 0 / 50%)": any of the
// forms getComputedStyle may give back, never read as transparent by mistake.
export function parseColor(value: string): Rgba | undefined {
  const match = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d+(?:\.\d+)?)(%?))?\s*\)$/.exec(value.trim());
  if (!match) return undefined;
  const alpha = match[4] === undefined ? 1 : match[5] === "%" ? Number(match[4]) / 100 : Number(match[4]);
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: alpha };
}

export function isOpaque(color: Rgba | undefined, expected: { r: number; g: number; b: number }): boolean {
  return color !== undefined && color.a === 1 && color.r === expected.r && color.g === expected.g && color.b === expected.b;
}

// The gauge item's DOM, or undefined while it is not in the status bar.
export async function gaugeDom(): Promise<GaugeDom | undefined> {
  const dom = await browser.execute((id: string) => {
    const element = document.getElementById(id);
    if (!element) return null;
    return { text: element.innerText.replace(/\s+/g, " ").trim(), classes: Array.from(element.classList), background: getComputedStyle(element).backgroundColor };
  }, GAUGE_ITEM_ID);
  return dom ?? undefined;
}

// The status bar items' accessible names, as wdio-vscode-service reads them.
export async function statusBarItems(): Promise<string[]> {
  return (await browser.getWorkbench()).getStatusBar().getItems();
}

export async function gaugeLabel(): Promise<string | undefined> {
  return (await statusBarItems()).find((item) => item.includes("AI Credits this month") || item.includes("No sessions this month"));
}

// "at least 29.40 of 1,000": the figure the aria label gives.
export function usedFrom(label: string): number {
  const match = /AI Credits this month: (?:at least )?([\d,]+\.\d\d) of/.exec(label);
  if (!match) throw new Error(`No month-to-date figure in "${label}"`);
  return Number(match[1]!.replace(/,/g, ""));
}

// The day the billing period starts: three days before the run, so every
// fixture session (all within 72 hours of the run date) lies inside it, and
// never past the 28th, the most a reset day may be.
export function resetDayFor(now: Date): number {
  return Math.min(new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).getDate(), 28);
}
