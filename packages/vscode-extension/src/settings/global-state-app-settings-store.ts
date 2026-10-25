import type { AppSettingsStore } from "@agent-cost-analyzer/server/src/data-sources/log-providers/app-settings";

// The slice of vscode.Memento (context.globalState) the store needs.
export interface Memento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export interface GlobalStateAppSettingsStoreOptions {
  // Hears a write that couldn't be persisted; the value stays in effect for
  // this session either way.
  onError?: (setting: "activeProviderId" | "minRetainedSessionLogsThreshold", error: unknown) => void;
}

const ACTIVE_PROVIDER_KEY = "aiCreditsAnalyzer.activeProviderId";
const THRESHOLD_KEY = "aiCreditsAnalyzer.minRetainedSessionLogsThreshold";

// The extension's AppSettingsStore (vscode-extension.md D5): its own
// settings live in context.globalState, so they survive restarts and the
// extension never writes to VS Code's own files (§11.2) or to the standalone
// app's settings file.
//
// AppSettingsStore reads are synchronous but Memento.update is async, so
// the values are cached: loaded once at construction, and a write updates
// the cache at once and then persists in the background. A failed persist is
// reported to onError and doesn't roll the cache back, so the setting holds
// for this session even if it's lost on restart. Values of the wrong type
// (hand-edited state) read as "nothing persisted".
export class GlobalStateAppSettingsStore implements AppSettingsStore {
  private activeProviderId: string | undefined;
  private minRetainedSessionLogsThreshold: number | undefined;

  constructor(
    private readonly memento: Memento,
    private readonly options: GlobalStateAppSettingsStoreOptions = {},
  ) {
    const provider = memento.get<unknown>(ACTIVE_PROVIDER_KEY);
    this.activeProviderId = typeof provider === "string" ? provider : undefined;
    const threshold = memento.get<unknown>(THRESHOLD_KEY);
    this.minRetainedSessionLogsThreshold = typeof threshold === "number" ? threshold : undefined;
  }

  readActiveProviderId(): string | undefined {
    return this.activeProviderId;
  }

  writeActiveProviderId(activeProviderId: string): void {
    this.activeProviderId = activeProviderId;
    this.persist("activeProviderId", ACTIVE_PROVIDER_KEY, activeProviderId);
  }

  readMinRetainedSessionLogsThreshold(): number | undefined {
    return this.minRetainedSessionLogsThreshold;
  }

  writeMinRetainedSessionLogsThreshold(minRetainedSessionLogsThreshold: number): void {
    this.minRetainedSessionLogsThreshold = minRetainedSessionLogsThreshold;
    this.persist("minRetainedSessionLogsThreshold", THRESHOLD_KEY, minRetainedSessionLogsThreshold);
  }

  private persist(
    setting: "activeProviderId" | "minRetainedSessionLogsThreshold",
    key: string,
    value: string | number,
  ): void {
    try {
      this.memento.update(key, value).then(undefined, (error: unknown) => this.options.onError?.(setting, error));
    } catch (error) {
      this.options.onError?.(setting, error);
    }
  }
}
