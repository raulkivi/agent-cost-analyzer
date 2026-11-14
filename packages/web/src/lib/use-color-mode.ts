// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useEffect, useState } from "react";
import {
  applyColorMode,
  PREFERS_DARK_QUERY,
  readColorModePreference,
  resolveColorMode,
  writeColorModePreference,
  type ColorModePreference,
} from "./color-mode.js";

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// `enabled` is false where the host owns the colours (VS Code webview):
// nothing is read, applied or listened to there.
export function useColorMode(enabled = true) {
  const [preference, setPreferenceState] = useState<ColorModePreference>(() =>
    enabled ? readColorModePreference(localStorageOrNull()) : "auto",
  );

  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    // jsdom and very old webviews have no matchMedia: treat as light.
    const query = window.matchMedia?.(PREFERS_DARK_QUERY);
    applyColorMode(root, resolveColorMode(preference, query?.matches ?? false));
    // Only Auto tracks the OS; an explicit choice must not flip under it.
    if (preference !== "auto" || !query) return;
    const onChange = (event: { matches: boolean }) => applyColorMode(root, resolveColorMode("auto", event.matches));
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [enabled, preference]);

  const setPreference = (next: ColorModePreference) => {
    writeColorModePreference(localStorageOrNull(), next);
    setPreferenceState(next);
  };

  return { preference, setPreference };
}
