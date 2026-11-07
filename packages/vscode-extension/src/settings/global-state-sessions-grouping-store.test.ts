import { describe, expect, it, vi } from "vitest";
import type { Memento } from "./global-state-app-settings-store.js";
import { GlobalStateSessionsGroupingStore, SESSIONS_GROUPING_KEY } from "./global-state-sessions-grouping-store.js";

// Step 15.14 (plan §11.9): the Sessions view's grouping, kept across
// workspaces and restarts in globalState.
function memento(initial: Record<string, unknown> = {}): Memento & { values: Map<string, unknown> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: (key: string, value: unknown) => {
      values.set(key, value);
      return Promise.resolve();
    },
  };
}

describe("GlobalStateSessionsGroupingStore", () => {
  it("reads nothing when no grouping was saved", () => {
    expect(new GlobalStateSessionsGroupingStore(memento()).read()).toBeUndefined();
  });

  it("saves the grouping in globalState and reads it back", () => {
    const state = memento();
    new GlobalStateSessionsGroupingStore(state).write("repository");

    expect(state.values.get(SESSIONS_GROUPING_KEY)).toBe("repository");
    expect(new GlobalStateSessionsGroupingStore(state).read()).toBe("repository");
  });

  it("ignores a hand-edited value that isn't a grouping", () => {
    expect(new GlobalStateSessionsGroupingStore(memento({ [SESSIONS_GROUPING_KEY]: "by-colour" })).read()).toBeUndefined();
  });

  it("reports a write that couldn't be saved, and keeps it for this session", async () => {
    const onError = vi.fn();
    const failing: Memento = { get: () => undefined, update: () => Promise.reject(new Error("disk full")) };
    const store = new GlobalStateSessionsGroupingStore(failing, onError);

    store.write("repository");
    await Promise.resolve();

    expect(store.read()).toBe("repository");
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "disk full" }));
  });
});
