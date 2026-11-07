// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetViewStateStorage, setViewStateStorage } from "./current-view-state-storage.js";
import { memoryViewStateStorage } from "./view-state-storage.js";
import { EXTRA_MODELS_KEY, useExtraVendorModels } from "./use-extra-vendor-models.js";
import { getViewStateStorage } from "./current-view-state-storage.js";

describe("useExtraVendorModels", () => {
  beforeEach(() => setViewStateStorage(memoryViewStateStorage()));
  afterEach(() => resetViewStateStorage());

  it("starts empty, adds without duplicates, removes, and persists", () => {
    const { result } = renderHook(() => useExtraVendorModels());
    expect(result.current.modelIds).toEqual([]);
    act(() => result.current.add("a"));
    act(() => result.current.add("a"));
    act(() => result.current.add("b"));
    expect(result.current.modelIds).toEqual(["a", "b"]);
    expect(getViewStateStorage().get(EXTRA_MODELS_KEY)).toEqual(["a", "b"]);
    act(() => result.current.remove("a"));
    expect(result.current.modelIds).toEqual(["b"]);
  });

  it("restores a saved list and ignores a malformed one", () => {
    getViewStateStorage().set(EXTRA_MODELS_KEY, ["x"]);
    expect(renderHook(() => useExtraVendorModels()).result.current.modelIds).toEqual(["x"]);
    getViewStateStorage().set(EXTRA_MODELS_KEY, [1, "y"]);
    expect(renderHook(() => useExtraVendorModels()).result.current.modelIds).toEqual([]);
  });
});
