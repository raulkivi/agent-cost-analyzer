// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
export type ColorModePreference = "auto" | "light" | "dark";
export type ColorMode = "light" | "dark";

export const COLOR_MODE_STORAGE_KEY = "aca.colorMode";

export interface ColorModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const PREFERENCES: readonly ColorModePreference[] = ["auto", "light", "dark"];

export function resolveColorMode(preference: ColorModePreference, prefersDark: boolean): ColorMode {
  if (preference === "auto") return prefersDark ? "dark" : "light";
  return preference;
}

// Storage can be missing or throw (blocked site data, private windows,
// sandboxed iframes); the preference then just doesn't persist.
export function readColorModePreference(storage: ColorModeStorage | null): ColorModePreference {
  try {
    const stored = storage?.getItem(COLOR_MODE_STORAGE_KEY);
    return PREFERENCES.find((preference) => preference === stored) ?? "auto";
  } catch {
    return "auto";
  }
}

export function writeColorModePreference(storage: ColorModeStorage | null, preference: ColorModePreference): void {
  try {
    storage?.setItem(COLOR_MODE_STORAGE_KEY, preference);
  } catch {
    // Not persisted; the switch still works for this page view.
  }
}

export function applyColorMode(root: HTMLElement, mode: ColorMode): void {
  root.dataset.colorMode = mode;
}

// Runs before the first render so the page never paints in the wrong
// scheme. Skipped where the host owns the colours (VS Code webview).
export function initColorMode(
  enabled: boolean,
  root: HTMLElement,
  storage: ColorModeStorage | null,
  prefersDark: boolean,
): void {
  if (!enabled) return;
  applyColorMode(root, resolveColorMode(readColorModePreference(storage), prefersDark));
}

export const PREFERS_DARK_QUERY = "(prefers-color-scheme: dark)";
