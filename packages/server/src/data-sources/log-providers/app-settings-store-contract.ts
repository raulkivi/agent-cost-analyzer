import { describe, expect, it } from "vitest";
import type { AppSettingsStore } from "./app-settings.js";

// Shared assertions every AppSettingsStore must satisfy (vscode-extension.md
// D5): the standalone app's file-backed store and the extension's
// globalState-backed one run these same tests, so the registry and
// ApiService can't tell them apart. `buildEmptyStore` returns a fresh store
// with nothing persisted yet; `reopen` returns a second store over the same
// backing storage (a new instance reading what the first one wrote).
export interface AppSettingsStoreContractFixture {
  buildEmptyStore: () => AppSettingsStore;
  reopen: (store: AppSettingsStore) => AppSettingsStore;
}

export function describeAppSettingsStoreContract(
  label: string,
  fixture: AppSettingsStoreContractFixture,
): void {
  describe(`AppSettingsStore contract: ${label}`, () => {
    it("reads undefined for both keys before anything was written", () => {
      const store = fixture.buildEmptyStore();

      expect(store.readActiveProviderId()).toBeUndefined();
      expect(store.readMinRetainedSessionLogsThreshold()).toBeUndefined();
    });

    it("round-trips the active provider id across a reopened store", () => {
      const store = fixture.buildEmptyStore();

      store.writeActiveProviderId("mitmproxy");

      expect(store.readActiveProviderId()).toBe("mitmproxy");
      expect(fixture.reopen(store).readActiveProviderId()).toBe("mitmproxy");
    });

    it("round-trips the retention threshold across a reopened store", () => {
      const store = fixture.buildEmptyStore();

      store.writeMinRetainedSessionLogsThreshold(300);

      expect(store.readMinRetainedSessionLogsThreshold()).toBe(300);
      expect(fixture.reopen(store).readMinRetainedSessionLogsThreshold()).toBe(300);
    });

    it("keeps each key when the other one is written, in both orders", () => {
      const first = fixture.buildEmptyStore();
      first.writeActiveProviderId("pi-agent");
      first.writeMinRetainedSessionLogsThreshold(150);

      const second = fixture.buildEmptyStore();
      second.writeMinRetainedSessionLogsThreshold(100);
      second.writeActiveProviderId("claude-code");

      expect(first.readActiveProviderId()).toBe("pi-agent");
      expect(first.readMinRetainedSessionLogsThreshold()).toBe(150);
      expect(second.readActiveProviderId()).toBe("claude-code");
      expect(second.readMinRetainedSessionLogsThreshold()).toBe(100);
    });

    it("overwrites a previously written value", () => {
      const store = fixture.buildEmptyStore();

      store.writeMinRetainedSessionLogsThreshold(300);
      store.writeMinRetainedSessionLogsThreshold(250);

      expect(store.readMinRetainedSessionLogsThreshold()).toBe(250);
    });
  });
}
