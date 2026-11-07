// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { getViewStateStorage, resetViewStateStorage } from "./current-view-state-storage.js";
import { useFirstTimeOpen } from "./use-first-time-open.js";

describe("useFirstTimeOpen (step 14.7)", () => {
  beforeEach(() => resetViewStateStorage());

  it("is open the first time a viewer sees it, closed every time after, and toggles", () => {
    const first = renderHook(() => useFirstTimeOpen("seen"));
    expect(first.result.current[0]).toBe(true);
    act(() => first.result.current[1](false));
    expect(first.result.current[0]).toBe(false);
    expect(getViewStateStorage().get("seen")).toBe(true);

    const second = renderHook(() => useFirstTimeOpen("seen"));
    expect(second.result.current[0]).toBe(false);
  });
});
