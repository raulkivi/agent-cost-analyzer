// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLOR_MODE_STORAGE_KEY } from "./color-mode.js";
import { useColorMode } from "./use-color-mode.js";

type Listener = (event: { matches: boolean }) => void;

let prefersDark = false;
let listeners: Set<Listener>;

function setOsDark(value: boolean) {
  prefersDark = value;
  for (const listener of listeners) listener({ matches: value });
}

beforeEach(() => {
  prefersDark = false;
  listeners = new Set();
  window.localStorage.clear();
  delete document.documentElement.dataset.colorMode;
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return prefersDark;
    },
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useColorMode", () => {
  it("starts on auto and applies the OS scheme", () => {
    prefersDark = true;
    const { result } = renderHook(() => useColorMode());
    expect(result.current.preference).toBe("auto");
    expect(document.documentElement.dataset.colorMode).toBe("dark");
  });

  it("in auto follows an OS change", () => {
    const { result } = renderHook(() => useColorMode());
    expect(document.documentElement.dataset.colorMode).toBe("light");
    act(() => setOsDark(true));
    expect(document.documentElement.dataset.colorMode).toBe("dark");
    expect(result.current.preference).toBe("auto");
  });

  it("an explicit preference ignores OS changes", () => {
    const { result } = renderHook(() => useColorMode());
    act(() => result.current.setPreference("light"));
    act(() => setOsDark(true));
    expect(document.documentElement.dataset.colorMode).toBe("light");
    expect(listeners.size).toBe(0);
  });

  it("switching applies immediately and persists", () => {
    const { result } = renderHook(() => useColorMode());
    act(() => result.current.setPreference("dark"));
    expect(document.documentElement.dataset.colorMode).toBe("dark");
    expect(window.localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe("dark");
  });

  it("reads the stored preference on mount", () => {
    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, "dark");
    const { result } = renderHook(() => useColorMode());
    expect(result.current.preference).toBe("dark");
    expect(document.documentElement.dataset.colorMode).toBe("dark");
  });

  it("does nothing when disabled (the VS Code webview)", () => {
    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, "dark");
    renderHook(() => useColorMode(false));
    expect(document.documentElement.dataset.colorMode).toBeUndefined();
    expect(listeners.size).toBe(0);
  });
});
