// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  applyColorMode,
  initColorMode,
  COLOR_MODE_STORAGE_KEY,
  readColorModePreference,
  resolveColorMode,
  writeColorModePreference,
  type ColorModeStorage,
} from "./color-mode.js";

function memoryStorage(initial: Record<string, string> = {}): ColorModeStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const throwing: ColorModeStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("quota");
  },
};

describe("resolveColorMode", () => {
  it.each([
    ["auto", true, "dark"],
    ["auto", false, "light"],
    ["light", true, "light"],
    ["light", false, "light"],
    ["dark", true, "dark"],
    ["dark", false, "dark"],
  ] as const)("%s with prefersDark=%s is %s", (pref, prefersDark, expected) => {
    expect(resolveColorMode(pref, prefersDark)).toBe(expected);
  });
});

describe("colour-mode preference storage", () => {
  it("uses the aca.colorMode key", () => {
    expect(COLOR_MODE_STORAGE_KEY).toBe("aca.colorMode");
  });

  it("round-trips each preference", () => {
    const storage = memoryStorage();
    for (const pref of ["auto", "light", "dark"] as const) {
      writeColorModePreference(storage, pref);
      expect(readColorModePreference(storage)).toBe(pref);
    }
  });

  it("falls back to auto for nothing stored, bad values, null or throwing storage", () => {
    expect(readColorModePreference(memoryStorage())).toBe("auto");
    expect(readColorModePreference(memoryStorage({ [COLOR_MODE_STORAGE_KEY]: "purple" }))).toBe("auto");
    expect(readColorModePreference(null)).toBe("auto");
    expect(readColorModePreference(throwing)).toBe("auto");
  });

  it("does not throw when writing to null or throwing storage", () => {
    expect(() => writeColorModePreference(null, "dark")).not.toThrow();
    expect(() => writeColorModePreference(throwing, "dark")).not.toThrow();
  });
});

describe("applyColorMode", () => {
  it("sets data-color-mode on the root", () => {
    const root = document.createElement("html");
    applyColorMode(root, "dark");
    expect(root.dataset.colorMode).toBe("dark");
    applyColorMode(root, "light");
    expect(root.getAttribute("data-color-mode")).toBe("light");
  });
});

describe("initColorMode (the pre-render step in main.tsx)", () => {
  it("applies the stored or OS-derived mode when the host offers the switch", () => {
    const root = document.createElement("html");
    initColorMode(true, root, memoryStorage(), true);
    expect(root.dataset.colorMode).toBe("dark");
    initColorMode(true, root, memoryStorage({ [COLOR_MODE_STORAGE_KEY]: "light" }), true);
    expect(root.dataset.colorMode).toBe("light");
  });

  it("never touches the root in the VS Code webview", () => {
    const root = document.createElement("html");
    initColorMode(false, root, memoryStorage({ [COLOR_MODE_STORAGE_KEY]: "dark" }), true);
    expect(root.hasAttribute("data-color-mode")).toBe(false);
  });
});
