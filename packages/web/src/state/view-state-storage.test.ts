import { describe, expect, it, vi } from "vitest";
import type { ApiTransport, ViewStatePersistence } from "../api-client/transport.js";
import {
  localViewStateStorage,
  memoryViewStateStorage,
  viewStateStorageFor,
  webviewViewStateStorage,
} from "./view-state-storage.js";

// A webview API's getState/setState, holding one state object.
function fakeWebviewState(initial: unknown = undefined): ViewStatePersistence & { state: unknown } {
  const fake = {
    state: initial,
    getState: () => fake.state,
    setState: (next: unknown) => {
      fake.state = next;
    },
  };
  return fake;
}

// The slice of window.localStorage the storage uses.
function fakeLocalStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

describe("view-state storage (§3.5 Layout: kept visible columns)", () => {
  describe("in a VS Code webview", () => {
    it("keeps each key in the webview's one state object", () => {
      const webview = fakeWebviewState();
      const storage = webviewViewStateStorage(webview);

      storage.set("turnColumns", ["turn", "model"]);
      storage.set("other", 1);

      expect(webview.state).toEqual({ turnColumns: ["turn", "model"], other: 1 });
      expect(storage.get("turnColumns")).toEqual(["turn", "model"]);
    });

    it("keeps state another part of the webview stored there", () => {
      const storage = webviewViewStateStorage(fakeWebviewState({ scroll: 40 }));

      storage.set("turnColumns", ["turn"]);

      expect(storage.get("scroll")).toBe(40);
    });

    it("reads nothing from an empty or non-object state", () => {
      expect(webviewViewStateStorage(fakeWebviewState()).get("turnColumns")).toBeUndefined();
      expect(webviewViewStateStorage(fakeWebviewState("junk")).get("turnColumns")).toBeUndefined();
    });
  });

  describe("in the standalone browser app", () => {
    it("round-trips JSON through localStorage under an app prefix", () => {
      const local = fakeLocalStorage();
      const storage = localViewStateStorage(() => local);

      storage.set("turnColumns", ["turn", "model"]);

      expect([...local.items.keys()]).toEqual(["copilot-cost-analyzer:turnColumns"]);
      expect(storage.get("turnColumns")).toEqual(["turn", "model"]);
    });

    it("never throws: blocked storage, quota errors and bad JSON read as nothing stored", () => {
      const throwing = () => {
        throw new Error("SecurityError");
      };
      const blocked = localViewStateStorage(throwing);
      expect(() => blocked.set("turnColumns", ["turn"])).not.toThrow();
      expect(blocked.get("turnColumns")).toBeUndefined();

      const full = localViewStateStorage(() => ({ getItem: () => "{not json", setItem: throwing }));
      expect(() => full.set("turnColumns", ["turn"])).not.toThrow();
      expect(full.get("turnColumns")).toBeUndefined();
    });
  });

  it("has an in-memory storage for tests and hosts with neither", () => {
    const storage = memoryViewStateStorage();

    storage.set("turnColumns", ["turn"]);

    expect(storage.get("turnColumns")).toEqual(["turn"]);
    expect(storage.get("missing")).toBeUndefined();
  });

  describe("viewStateStorageFor", () => {
    it("uses the transport's webview state when it has one", () => {
      const webview = fakeWebviewState();
      const transport: ApiTransport = { call: vi.fn(), viewState: webview };

      viewStateStorageFor(transport, () => fakeLocalStorage()).set("turnColumns", ["turn"]);

      expect(webview.state).toEqual({ turnColumns: ["turn"] });
    });

    it("falls back to localStorage over HTTP", () => {
      const local = fakeLocalStorage();

      viewStateStorageFor({ call: vi.fn() }, () => local).set("turnColumns", ["turn"]);

      expect(local.items.size).toBe(1);
    });
  });
});
