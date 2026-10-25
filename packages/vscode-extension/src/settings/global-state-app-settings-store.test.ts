import { describe, expect, it, vi } from "vitest";
import { describeAppSettingsStoreContract } from "@agent-cost-analyzer/server/src/data-sources/log-providers/app-settings-store-contract";
import { GlobalStateAppSettingsStore, type Memento } from "./global-state-app-settings-store.js";

// A Memento that, like VS Code's, takes the new value immediately and
// reports persistence later.
class FakeMemento implements Memento {
  readonly values = new Map<string, unknown>();
  readonly updates: Promise<void>[] = [];

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  update(key: string, value: unknown): PromiseLike<void> {
    this.values.set(key, value);
    const done = Promise.resolve();
    this.updates.push(done);
    return done;
  }
}

const mementos = new WeakMap<GlobalStateAppSettingsStore, FakeMemento>();

function buildOver(memento: FakeMemento): GlobalStateAppSettingsStore {
  const store = new GlobalStateAppSettingsStore(memento);
  mementos.set(store, memento);
  return store;
}

describeAppSettingsStoreContract("GlobalStateAppSettingsStore", {
  buildEmptyStore: () => buildOver(new FakeMemento()),
  reopen: (store) => buildOver(mementos.get(store as GlobalStateAppSettingsStore)!),
});

describe("GlobalStateAppSettingsStore (vscode-extension.md D5)", () => {
  it("reads synchronously from a cache, though Memento.update is async: a write is visible before it's persisted", () => {
    let finish!: () => void;
    const memento = {
      get: () => undefined,
      update: () => new Promise<void>((resolve) => (finish = resolve)),
    };
    const store = new GlobalStateAppSettingsStore(memento);

    store.writeMinRetainedSessionLogsThreshold(300);

    expect(store.readMinRetainedSessionLogsThreshold()).toBe(300);
    finish();
  });

  it("persists each write to its own namespaced global-state key", () => {
    const memento = new FakeMemento();
    const store = new GlobalStateAppSettingsStore(memento);

    store.writeActiveProviderId("vscode");
    store.writeMinRetainedSessionLogsThreshold(250);

    expect(Object.fromEntries(memento.values)).toEqual({
      "aiCreditsAnalyzer.activeProviderId": "vscode",
      "aiCreditsAnalyzer.minRetainedSessionLogsThreshold": 250,
    });
  });

  it("loads what an earlier session persisted", () => {
    const memento = new FakeMemento();
    memento.values.set("aiCreditsAnalyzer.activeProviderId", "vscode");
    memento.values.set("aiCreditsAnalyzer.minRetainedSessionLogsThreshold", 400);

    const store = new GlobalStateAppSettingsStore(memento);

    expect(store.readActiveProviderId()).toBe("vscode");
    expect(store.readMinRetainedSessionLogsThreshold()).toBe(400);
  });

  it("treats persisted values of the wrong type as nothing persisted", () => {
    const memento = new FakeMemento();
    memento.values.set("aiCreditsAnalyzer.activeProviderId", 7);
    memento.values.set("aiCreditsAnalyzer.minRetainedSessionLogsThreshold", "lots");

    const store = new GlobalStateAppSettingsStore(memento);

    expect(store.readActiveProviderId()).toBeUndefined();
    expect(store.readMinRetainedSessionLogsThreshold()).toBeUndefined();
  });

  it("reports a failed persist to onError and keeps the cached value for this session", async () => {
    const failure = new Error("disk full");
    const onError = vi.fn();
    const store = new GlobalStateAppSettingsStore({ get: () => undefined, update: () => Promise.reject(failure) }, { onError });

    store.writeActiveProviderId("vscode");
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("activeProviderId", failure));

    expect(store.readActiveProviderId()).toBe("vscode");
  });

  it("reports a synchronous throw from update the same way, without throwing from the write", () => {
    const onError = vi.fn();
    const store = new GlobalStateAppSettingsStore(
      {
        get: () => undefined,
        update: () => {
          throw new Error("boom");
        },
      },
      { onError },
    );

    expect(() => store.writeMinRetainedSessionLogsThreshold(300)).not.toThrow();
    expect(onError).toHaveBeenCalledWith("minRetainedSessionLogsThreshold", expect.any(Error));
  });
});
