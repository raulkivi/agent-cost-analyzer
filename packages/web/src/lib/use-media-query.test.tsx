// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "./use-media-query.js";

afterEach(() => vi.unstubAllGlobals());

describe("useMediaQuery", () => {
  it("is false where there is no matchMedia (jsdom)", () => {
    expect(renderHook(() => useMediaQuery("(max-width: 480px)")).result.current).toBe(false);
  });

  it("follows the query as the window changes", () => {
    let listener: ((event: { matches: boolean }) => void) | undefined;
    const query = {
      matches: true,
      addEventListener: (_: string, handler: typeof listener) => void (listener = handler),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", vi.fn(() => query));

    const { result, unmount } = renderHook(() => useMediaQuery("(max-width: 480px)"));
    expect(result.current).toBe(true);

    act(() => listener?.({ matches: false }));
    expect(result.current).toBe(false);

    unmount();
    expect(query.removeEventListener).toHaveBeenCalled();
  });
});
