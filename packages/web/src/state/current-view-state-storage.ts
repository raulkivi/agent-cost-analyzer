import { memoryViewStateStorage, type ViewStateStorage } from "./view-state-storage.js";

// Like host/current-host-capabilities.ts: main.tsx installs the storage
// for its transport once at startup. The in-memory default keeps tests
// (and any host with no storage at all) from sharing preferences.
let current: ViewStateStorage | undefined;

export function setViewStateStorage(storage: ViewStateStorage): void {
  current = storage;
}

export function getViewStateStorage(): ViewStateStorage {
  current ??= memoryViewStateStorage();
  return current;
}

// Test helper: back to a fresh in-memory default.
export function resetViewStateStorage(): void {
  current = undefined;
}
