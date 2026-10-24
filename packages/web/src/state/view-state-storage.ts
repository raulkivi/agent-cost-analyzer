import type { ApiTransport, ViewStatePersistence } from "../api-client/transport.js";

// Where small UI preferences live between visits (§3.5 Layout: "users
// choose and keep the visible columns"): the webview's own state in VS
// Code, localStorage in the standalone app. Values are JSON-safe; a read
// that finds nothing usable returns undefined, and nothing here throws.
export interface ViewStateStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

// The slice of window.localStorage this needs.
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const LOCAL_PREFIX = "copilot-cost-analyzer:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// One state object per webview, so each key is merged into it.
export function webviewViewStateStorage(webview: ViewStatePersistence): ViewStateStorage {
  const current = () => {
    const state = webview.getState();
    return isRecord(state) ? state : {};
  };
  return {
    get: (key) => current()[key],
    set: (key, value) => webview.setState({ ...current(), [key]: value }),
  };
}

// localStorage can be missing or throw (private windows, blocked site
// data, quota), so every access is guarded and a failure means "nothing
// stored".
export function localViewStateStorage(store: () => KeyValueStore | undefined): ViewStateStorage {
  return {
    get(key) {
      try {
        const raw = store()?.getItem(LOCAL_PREFIX + key);
        return raw === null || raw === undefined ? undefined : (JSON.parse(raw) as unknown);
      } catch {
        return undefined;
      }
    },
    set(key, value) {
      try {
        store()?.setItem(LOCAL_PREFIX + key, JSON.stringify(value));
      } catch {
        // Not kept; the preference still applies until the page closes.
      }
    },
  };
}

export function memoryViewStateStorage(): ViewStateStorage {
  const values = new Map<string, unknown>();
  return { get: (key) => values.get(key), set: (key, value) => values.set(key, value) };
}

// The webview's state when the transport carries one, else localStorage.
export function viewStateStorageFor(transport: ApiTransport, store: () => KeyValueStore | undefined): ViewStateStorage {
  return transport.viewState ? webviewViewStateStorage(transport.viewState) : localViewStateStorage(store);
}
