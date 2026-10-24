import { afterEach, describe, expect, it } from "vitest";
import { getViewStateStorage, resetViewStateStorage, setViewStateStorage } from "./current-view-state-storage.js";
import { memoryViewStateStorage } from "./view-state-storage.js";

describe("current view-state storage", () => {
  afterEach(() => {
    resetViewStateStorage();
  });

  it("defaults to a fresh in-memory storage, so tests never share preferences", () => {
    getViewStateStorage().set("turnColumns", ["turn"]);

    resetViewStateStorage();

    expect(getViewStateStorage().get("turnColumns")).toBeUndefined();
  });

  it("returns the storage main.tsx installed", () => {
    const installed = memoryViewStateStorage();

    setViewStateStorage(installed);

    expect(getViewStateStorage()).toBe(installed);
  });
});
